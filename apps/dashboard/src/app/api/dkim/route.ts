import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { getMailPool } from "@/lib/db/connection";
import { RowDataPacket } from "mysql2/promise";

const DKIM_BASE_DIR = "/etc/opendkim/keys";
const DKIM_KEY_TABLE = "/etc/opendkim/key.table";
const DKIM_SIGNING_TABLE = "/etc/opendkim/signing.table";

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
  const keyDir = join(DKIM_BASE_DIR, domain);
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

  // Get file creation date
  let createdAt = "";
  try {
    const stat = execFileSync("stat", ["-c", "%Y", privateKeyPath], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    createdAt = new Date(parseInt(stat, 10) * 1000).toISOString().split("T")[0];
  } catch {
    // Can't get date
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

    // Validate domain format
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
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

    const keyDir = join(DKIM_BASE_DIR, domain);

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
  try {
    const domain = request.nextUrl.searchParams.get("domain");

    if (!domain || !/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
      return NextResponse.json({ error: "Valid domain name is required" }, { status: 400 });
    }

    const keyDir = join(DKIM_BASE_DIR, domain);

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

    return NextResponse.json({ message: `DKIM key for ${domain} deleted successfully` });
  } catch (error) {
    console.error("Error deleting DKIM key:", error);
    return NextResponse.json(
      { error: "Failed to delete DKIM key" },
      { status: 500 }
    );
  }
}
