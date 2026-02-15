import { NextRequest, NextResponse } from "next/server";
import { spawnSync, execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { getMailPool } from "@/lib/db/connection";
import { RowDataPacket } from "mysql2/promise";
import { requireAdmin } from "@/lib/api/helpers";

const DKIM_BASE_DIR = "/etc/opendkim/keys";
const DKIM_KEY_TABLE = "/etc/opendkim/key.table";
const DKIM_SIGNING_TABLE = "/etc/opendkim/signing.table";

// ── Sudo helpers ──

/** Run a command via sudo, returning status and output */
function sudoExec(cmd: string, args: string[]): { ok: boolean; stderr: string; stdout: string } {
  const result = spawnSync("/usr/bin/sudo", [cmd, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  return {
    ok: result.status === 0,
    stderr: (result.stderr || "").trim(),
    stdout: (result.stdout || "").trim(),
  };
}

/** Write content to a file via sudo tee (path must be under /etc/opendkim/) */
function sudoWriteFile(filePath: string, content: string): { ok: boolean; error?: string } {
  const path = resolve(filePath);
  if (!path.startsWith("/etc/opendkim/")) {
    return { ok: false, error: `Path ${path} is not under /etc/opendkim/` };
  }
  const result = spawnSync("/usr/bin/sudo", ["/usr/bin/tee", path], {
    input: content,
    encoding: "utf8",
    timeout: 10000,
  });
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || "").trim() || "Write failed" };
  }
  return { ok: true };
}

// ── Table entry management (reads directly since files are 644, writes via sudo tee) ──

/** Add an entry to key.table and signing.table for a domain/selector */
function addDkimTableEntries(domain: string, selector: string): void {
  const keyEntry = `${selector}._domainkey.${domain} ${domain}:${selector}:${DKIM_BASE_DIR}/${domain}/${selector}.private`;
  const signingEntry = `*@${domain} ${selector}._domainkey.${domain}`;

  // key.table
  let keyTable = existsSync(DKIM_KEY_TABLE) ? readFileSync(DKIM_KEY_TABLE, "utf8") : "";
  if (!keyTable.includes(`${selector}._domainkey.${domain}`)) {
    keyTable = keyTable.trimEnd() + (keyTable.trim() ? "\n" : "") + keyEntry + "\n";
    sudoWriteFile(DKIM_KEY_TABLE, keyTable);
  }

  // signing.table
  let signingTable = existsSync(DKIM_SIGNING_TABLE) ? readFileSync(DKIM_SIGNING_TABLE, "utf8") : "";
  if (!signingTable.includes(`*@${domain}`)) {
    signingTable = signingTable.trimEnd() + (signingTable.trim() ? "\n" : "") + signingEntry + "\n";
    sudoWriteFile(DKIM_SIGNING_TABLE, signingTable);
  }
}

/** Remove entries for a domain from key.table and signing.table */
function removeDkimTableEntries(domain: string): void {
  // key.table: remove any line containing the domain
  if (existsSync(DKIM_KEY_TABLE)) {
    const lines = readFileSync(DKIM_KEY_TABLE, "utf8").split("\n");
    const filtered = lines.filter((line) => !line.includes(` ${domain}:`));
    sudoWriteFile(DKIM_KEY_TABLE, filtered.join("\n"));
  }

  // signing.table: remove the *@domain line
  if (existsSync(DKIM_SIGNING_TABLE)) {
    const lines = readFileSync(DKIM_SIGNING_TABLE, "utf8").split("\n");
    const filtered = lines.filter((line) => !line.startsWith(`*@${domain} `));
    sudoWriteFile(DKIM_SIGNING_TABLE, filtered.join("\n"));
  }
}

// ── Key info reader ──

interface DkimKeyInfo {
  id: number;
  domain: string;
  selector: string;
  publicKey: string;
  dnsRecord: string;
  status: "active" | "missing" | "pending";
  createdAt: string;
  keySize: number;
}

function readDkimKeyForDomain(domain: string, selector: string = "mail"): Partial<DkimKeyInfo> {
  const keyDir = resolve(join(DKIM_BASE_DIR, domain));
  // Prevent path traversal
  if (!keyDir.startsWith(DKIM_BASE_DIR + "/")) {
    return { status: "missing", publicKey: "", dnsRecord: "", createdAt: "", keySize: 0 };
  }
  const publicKeyPath = join(keyDir, `${selector}.txt`);
  const privateKeyPath = join(keyDir, `${selector}.private`);

  // Keys are owned opendkim:opendkim — use sudo for all reads
  if (!sudoExec("/usr/bin/test", ["-f", privateKeyPath]).ok) {
    return { status: "missing", publicKey: "", dnsRecord: "", createdAt: "", keySize: 0 };
  }

  let publicKey = "";
  let dnsRecord = "";
  let keySize = 2048;

  // Read public key .txt file via sudo
  if (sudoExec("/usr/bin/test", ["-f", publicKeyPath]).ok) {
    const catResult = sudoExec("/usr/bin/cat", [publicKeyPath]);
    if (catResult.ok && catResult.stdout) {
      const pMatch = catResult.stdout.match(/p=([A-Za-z0-9+/=\s"]+)/);
      if (pMatch) {
        publicKey = pMatch[1].replace(/["'\s\n\r]/g, "");
        dnsRecord = `v=DKIM1; k=rsa; p=${publicKey}`;
      }
    }
  }

  // Fallback: extract public key from private key via sudo openssl
  if (!publicKey) {
    const pubResult = sudoExec("/usr/bin/openssl", ["rsa", "-in", privateKeyPath, "-pubout", "-outform", "PEM"]);
    if (pubResult.ok && pubResult.stdout) {
      const b64 = pubResult.stdout.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
      if (b64) {
        publicKey = b64;
        dnsRecord = `v=DKIM1; k=rsa; p=${publicKey}`;
      }
    }
  }

  // Get key size via sudo openssl
  const keySizeResult = sudoExec("/usr/bin/openssl", ["rsa", "-in", privateKeyPath, "-text", "-noout"]);
  if (keySizeResult.ok) {
    const bitsMatch = keySizeResult.stdout.match(/(\d+)\s+bit/);
    if (bitsMatch) keySize = parseInt(bitsMatch[1], 10);
  }

  // Check DNS
  let status: DkimKeyInfo["status"] = "pending";
  try {
    const dnsResult = execFileSync(
      "dig",
      ["+short", "TXT", `${selector}._domainkey.${domain}`],
      { encoding: "utf8", timeout: 5000 }
    ).trim();
    if (dnsResult && dnsResult.includes("DKIM1")) {
      status = "active";
    }
  } catch {
    // DNS lookup failed, keep as pending
  }

  // Get file modification date via sudo stat
  let createdAt = "";
  const statResult = sudoExec("/usr/bin/stat", ["-c", "%Y", privateKeyPath]);
  if (statResult.ok && statResult.stdout) {
    createdAt = new Date(parseInt(statResult.stdout.trim(), 10) * 1000).toISOString().split("T")[0];
  }

  return { status, publicKey, dnsRecord, createdAt, keySize };
}

// ── GET - List DKIM keys for all domains ──

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const pool = getMailPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, name FROM virtual_domains ORDER BY name"
    );

    const dkimKeys: DkimKeyInfo[] = rows.map((row) => {
      const keyInfo = readDkimKeyForDomain(row.name);
      return {
        id: row.id,
        domain: row.name,
        selector: "mail",
        publicKey: keyInfo.publicKey || "",
        dnsRecord: keyInfo.dnsRecord || "",
        status: keyInfo.status || "missing",
        createdAt: keyInfo.createdAt || "",
        keySize: keyInfo.keySize || 0,
      };
    });

    return NextResponse.json(dkimKeys);
  } catch (error) {
    console.error("Error fetching DKIM keys:", error);
    return NextResponse.json(
      { error: "Failed to fetch DKIM keys" },
      { status: 500 }
    );
  }
}

// ── POST - Generate a DKIM key for a domain ──

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { domain, selector = "mail", bits = 2048 } = body as {
      domain?: string;
      selector?: string;
      bits?: number;
    };

    if (!domain || typeof domain !== "string") {
      return NextResponse.json({ error: "Domain name is required" }, { status: 400 });
    }

    // Validate domain format (no consecutive dots, max 253 chars per RFC 1035)
    if (domain.length > 253 || !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(domain)) {
      return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
    }

    // Validate selector
    if (typeof selector !== "string" || !/^[a-zA-Z0-9_-]+$/.test(selector)) {
      return NextResponse.json({ error: "Invalid selector format" }, { status: 400 });
    }

    // Validate bits
    if (typeof bits !== "number" || ![1024, 2048, 4096].includes(bits)) {
      return NextResponse.json({ error: "Key size must be 1024, 2048, or 4096" }, { status: 400 });
    }

    // Verify domain exists in database
    const pool = getMailPool();
    const [domainRows] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM virtual_domains WHERE name = ?",
      [domain]
    );
    if (domainRows.length === 0) {
      return NextResponse.json({ error: "Domain not found in database" }, { status: 404 });
    }

    const keyDir = resolve(join(DKIM_BASE_DIR, domain));
    if (!keyDir.startsWith(DKIM_BASE_DIR + "/")) {
      return NextResponse.json({ error: "Invalid domain" }, { status: 400 });
    }

    // Create directory via sudo
    const mkdirResult = sudoExec("/usr/bin/mkdir", ["-p", keyDir]);
    if (!mkdirResult.ok) {
      console.error("Failed to create DKIM key directory:", mkdirResult.stderr);
      return NextResponse.json({ error: "Failed to create DKIM key directory" }, { status: 500 });
    }

    // Generate key via sudo opendkim-genkey
    const genResult = sudoExec("/usr/sbin/opendkim-genkey", [
      "-b", String(bits),
      "-d", domain,
      "-D", keyDir,
      "-s", selector,
      "-v",
    ]);
    if (!genResult.ok) {
      console.error("Error generating DKIM key:", genResult.stderr);
      return NextResponse.json({ error: "Failed to generate DKIM key" }, { status: 500 });
    }

    // Ensure opendkim group has no extra members (OpenDKIM rejects keys whose
    // group has multiple users). TCP milter makes socket-based group access unnecessary.
    sudoExec("/usr/bin/gpasswd", ["-d", "postfix", "opendkim"]);

    // Set ownership: opendkim:opendkim
    const chownResult = sudoExec("/usr/bin/chown", ["-R", "opendkim:opendkim", keyDir]);
    if (!chownResult.ok) {
      console.error("Failed to set DKIM key ownership:", chownResult.stderr);
    }

    // Set directory permissions to 750 (owner rwx, group rx)
    sudoExec("/usr/bin/chmod", ["750", keyDir]);

    // Set private key to 640 (owner rw, group r) and public key txt to 640
    const privateKeyPath = join(keyDir, `${selector}.private`);
    sudoExec("/usr/bin/chmod", ["640", privateKeyPath]);
    const publicKeyTxtPath = join(keyDir, `${selector}.txt`);
    sudoExec("/usr/bin/chmod", ["640", publicKeyTxtPath]);

    // Update key.table and signing.table
    try {
      addDkimTableEntries(domain, selector);
    } catch (tableError) {
      console.error("Error updating DKIM table files:", tableError);
    }

    // Read the generated key info
    const keyInfo = readDkimKeyForDomain(domain, selector);

    return NextResponse.json({
      domain,
      selector,
      publicKey: keyInfo.publicKey || "",
      dnsRecord: keyInfo.dnsRecord || "",
      status: keyInfo.status || "pending",
      createdAt: keyInfo.createdAt || new Date().toISOString().split("T")[0],
      keySize: bits,
    }, { status: 201 });
  } catch (error) {
    console.error("Error generating DKIM key:", error);
    return NextResponse.json(
      { error: "Failed to generate DKIM key" },
      { status: 500 }
    );
  }
}

// ── DELETE - Delete a DKIM key for a domain ──

export async function DELETE(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const domain = request.nextUrl.searchParams.get("domain");

    if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
      return NextResponse.json({ error: "Valid domain name is required" }, { status: 400 });
    }

    const keyDir = resolve(join(DKIM_BASE_DIR, domain));
    if (!keyDir.startsWith(DKIM_BASE_DIR + "/")) {
      return NextResponse.json({ error: "Invalid domain" }, { status: 400 });
    }

    if (!sudoExec("/usr/bin/test", ["-d", keyDir]).ok) {
      return NextResponse.json({ error: "No DKIM key found for this domain" }, { status: 404 });
    }

    // Remove key files via sudo
    try {
      const lsResult = sudoExec("/usr/bin/ls", [keyDir]);
      const files = lsResult.ok ? lsResult.stdout.split("\n").filter(Boolean) : [];
      for (const file of files) {
        const filePath = resolve(join(keyDir, file));
        // Verify resolved path stays within keyDir to prevent traversal
        if (!filePath.startsWith(keyDir + "/")) continue;
        const rmResult = sudoExec("/usr/bin/rm", [filePath]);
        if (!rmResult.ok) {
          throw new Error(`Failed to remove ${file}: ${rmResult.stderr}`);
        }
      }
      const rmdirResult = sudoExec("/usr/bin/rmdir", [keyDir]);
      if (!rmdirResult.ok) {
        throw new Error(`Failed to remove directory: ${rmdirResult.stderr}`);
      }
    } catch (rmError) {
      console.error("Error removing DKIM key files:", rmError);
      return NextResponse.json({ error: "Failed to remove DKIM key files" }, { status: 500 });
    }

    // Remove entries from key.table and signing.table
    try {
      removeDkimTableEntries(domain);
    } catch (tableError) {
      console.error("Error updating DKIM table files:", tableError);
    }

    return NextResponse.json({ message: `DKIM key for ${domain} deleted successfully` });
  } catch (error) {
    console.error("Error deleting DKIM key:", error);
    return NextResponse.json(
      { error: "Failed to delete DKIM key" },
      { status: 500 }
    );
  }
}
