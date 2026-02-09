import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { getMailPool } from "@/lib/db/connection";
import { RowDataPacket } from "mysql2/promise";
import { requireAdmin } from "@/lib/api/helpers";

const DKIM_BASE_DIR = "/etc/opendkim/keys";
const DKIM_KEY_TABLE = "/etc/opendkim/key.table";
const DKIM_SIGNING_TABLE = "/etc/opendkim/signing.table";

/** Atomic write: write to .tmp then rename to prevent corruption on crash */
function atomicWriteFile(filepath: string, content: string, mode: number): void {
  const tmpPath = filepath + ".tmp";
  writeFileSync(tmpPath, content, { encoding: "utf8", mode });
  renameSync(tmpPath, filepath);
}

/** Add an entry to key.table and signing.table for a domain/selector */
function addDkimTableEntries(domain: string, selector: string): void {
  const keyEntry = `${selector}._domainkey.${domain} ${domain}:${selector}:${DKIM_BASE_DIR}/${domain}/${selector}.private`;
  const signingEntry = `*@${domain} ${selector}._domainkey.${domain}`;

  // key.table
  let keyTable = existsSync(DKIM_KEY_TABLE) ? readFileSync(DKIM_KEY_TABLE, "utf8") : "";
  if (!keyTable.includes(`${selector}._domainkey.${domain}`)) {
    keyTable = keyTable.trimEnd() + (keyTable.trim() ? "\n" : "") + keyEntry + "\n";
    atomicWriteFile(DKIM_KEY_TABLE, keyTable, 0o644);
  }

  // signing.table
  let signingTable = existsSync(DKIM_SIGNING_TABLE) ? readFileSync(DKIM_SIGNING_TABLE, "utf8") : "";
  if (!signingTable.includes(`*@${domain}`)) {
    signingTable = signingTable.trimEnd() + (signingTable.trim() ? "\n" : "") + signingEntry + "\n";
    atomicWriteFile(DKIM_SIGNING_TABLE, signingTable, 0o644);
  }
}

/** Remove entries for a domain from key.table and signing.table */
function removeDkimTableEntries(domain: string): void {
  // key.table: remove any line containing the domain
  if (existsSync(DKIM_KEY_TABLE)) {
    const lines = readFileSync(DKIM_KEY_TABLE, "utf8").split("\n");
    const filtered = lines.filter((line) => !line.includes(` ${domain}:`));
    atomicWriteFile(DKIM_KEY_TABLE, filtered.join("\n"), 0o644);
  }

  // signing.table: remove the *@domain line
  if (existsSync(DKIM_SIGNING_TABLE)) {
    const lines = readFileSync(DKIM_SIGNING_TABLE, "utf8").split("\n");
    const filtered = lines.filter((line) => !line.startsWith(`*@${domain} `));
    atomicWriteFile(DKIM_SIGNING_TABLE, filtered.join("\n"), 0o644);
  }
}

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
  // Prevent path traversal — keyDir must stay within DKIM_BASE_DIR
  if (!keyDir.startsWith(DKIM_BASE_DIR + "/")) {
    return { status: "missing", publicKey: "", dnsRecord: "", createdAt: "", keySize: 0 };
  }
  const publicKeyPath = join(keyDir, `${selector}.txt`);
  const privateKeyPath = join(keyDir, `${selector}.private`);

  if (!existsSync(privateKeyPath)) {
    return { status: "missing", publicKey: "", dnsRecord: "", createdAt: "", keySize: 0 };
  }

  let publicKey = "";
  let dnsRecord = "";
  let keySize = 2048;

  if (existsSync(publicKeyPath)) {
    try {
      const content = readFileSync(publicKeyPath, "utf8");
      // Parse the opendkim-genkey output format:
      // mail._domainkey IN TXT ( "v=DKIM1; h=sha256; k=rsa; "
      //   "p=MIIBIjANBgkqh..." )
      const pMatch = content.match(/p=([A-Za-z0-9+/=\s"]+)/);
      if (pMatch) {
        publicKey = pMatch[1].replace(/["'\s\n\r]/g, "");
        dnsRecord = `v=DKIM1; k=rsa; p=${publicKey}`;
      }
    } catch {
      // Can't read public key file
    }
  }

  // Try to get key size from private key
  try {
    const output = execFileSync("openssl", ["rsa", "-in", privateKeyPath, "-text", "-noout"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const bitsMatch = output.match(/(\d+)\s+bit/);
    if (bitsMatch) keySize = parseInt(bitsMatch[1], 10);
  } catch {
    // Default key size
  }

  // Check if DNS record is configured by doing a DNS lookup
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

  // Get file modification date (use date -r for cross-platform compatibility)
  let createdAt = "";
  try {
    const stat = execFileSync("date", ["-r", privateKeyPath, "+%s"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    createdAt = new Date(parseInt(stat, 10) * 1000).toISOString().split("T")[0];
  } catch {
    // Fallback: try Linux stat format
    try {
      const stat = execFileSync("stat", ["-c", "%Y", privateKeyPath], {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      createdAt = new Date(parseInt(stat, 10) * 1000).toISOString().split("T")[0];
    } catch {
      // Can't get date
    }
  }

  return { status, publicKey, dnsRecord, createdAt, keySize };
}

// GET - List DKIM keys for all domains
export async function GET() {
  try {
    // Get domains from the database
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

// POST - Generate a DKIM key for a domain
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

    // Create directory if it doesn't exist
    if (!existsSync(keyDir)) {
      mkdirSync(keyDir, { recursive: true });
    }

    // Generate key using opendkim-genkey
    try {
      execFileSync("opendkim-genkey", [
        "-b", String(bits),
        "-d", domain,
        "-D", keyDir,
        "-s", selector,
        "-v",
      ], {
        encoding: "utf8",
        timeout: 30000,
      });
    } catch (genError) {
      console.error("Error generating DKIM key:", genError);
      return NextResponse.json({ error: "Failed to generate DKIM key" }, { status: 500 });
    }

    // Set ownership
    try {
      execFileSync("chown", ["-R", "opendkim:opendkim", keyDir], { timeout: 5000 });
      execFileSync("chmod", ["700", keyDir], { timeout: 5000 });
      execFileSync("chmod", ["600", join(keyDir, `${selector}.private`)], { timeout: 5000 });
    } catch {
      // Non-fatal - permissions may need manual fix
    }

    // Update key.table and signing.table
    try {
      addDkimTableEntries(domain, selector);
    } catch (tableError) {
      console.error("Error updating DKIM table files:", tableError);
      // Non-fatal: key was generated but table files need manual update
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

// DELETE - Delete a DKIM key for a domain
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

    if (!existsSync(keyDir)) {
      return NextResponse.json({ error: "No DKIM key found for this domain" }, { status: 404 });
    }

    // Remove key files
    try {
      const files = readdirSync(keyDir);
      for (const file of files) {
        unlinkSync(join(keyDir, file));
      }
      execFileSync("rmdir", [keyDir], { timeout: 5000 });
    } catch (rmError) {
      console.error("Error removing DKIM key files:", rmError);
      return NextResponse.json({ error: "Failed to remove DKIM key files" }, { status: 500 });
    }

    // Remove entries from key.table and signing.table
    try {
      removeDkimTableEntries(domain);
    } catch (tableError) {
      console.error("Error updating DKIM table files:", tableError);
      // Non-fatal: key files were removed but table files need manual update
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
