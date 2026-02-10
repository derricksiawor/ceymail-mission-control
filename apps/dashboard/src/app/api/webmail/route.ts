import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";
import { requireAdmin } from "@/lib/api/helpers";
import { getConfig } from "@/lib/config/config";

// ── Helpers ──

/** Check if a dpkg status output indicates a fully installed package */
function isDpkgInstalled(stdout: string): boolean {
  const statusMatch = stdout.match(/^Status:\s*(.+)$/m);
  return statusMatch ? statusMatch[1].trim() === "install ok installed" : false;
}

function readPostfixSetting(key: string): string {
  const result = spawnSync("/usr/sbin/postconf", [key], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.status !== 0) return "";
  const output = (result.stdout || "").trim();
  const eqIdx = output.indexOf("=");
  return eqIdx >= 0 ? output.slice(eqIdx + 1).trim() : "";
}

function phpEscape(s: string): string {
  if (s.includes("\0")) throw new Error("Null byte in PHP string value");
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** URL-encode a DSN component to prevent injection via special characters */
function dsnEncode(s: string): string {
  return encodeURIComponent(s);
}

/** Generate a 24-char DES key using rejection sampling to eliminate modulo bias */
function generateDesKey(): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#%^&*()-_+=";
  const maxValid = 256 - (256 % charset.length);
  const result: string[] = [];
  while (result.length < 24) {
    const bytes = crypto.randomBytes(32);
    for (const b of bytes) {
      if (result.length >= 24) break;
      if (b < maxValid) {
        result.push(charset[b % charset.length]);
      }
    }
  }
  return result.join("");
}

/** Generate a 32-char alphanumeric password (SQL-safe, no escaping needed) */
function generateDbPassword(): string {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const maxValid = 256 - (256 % charset.length);
  const result: string[] = [];
  while (result.length < 32) {
    const bytes = crypto.randomBytes(48);
    for (const b of bytes) {
      if (result.length >= 32) break;
      if (b < maxValid) {
        result.push(charset[b % charset.length]);
      }
    }
  }
  return result.join("");
}

function sudoWriteFile(filePath: string, content: string): { ok: boolean; error?: string } {
  const path = resolve(filePath);
  if (!path.startsWith("/etc/roundcube/")) {
    return { ok: false, error: `Path ${path} is not under /etc/roundcube/` };
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

// ── GET - Check Roundcube installation status ──

export async function GET() {
  try {
    // Check if roundcube package is fully installed (not just config remnants)
    const dpkgResult = spawnSync("/usr/bin/dpkg", ["-s", "roundcube"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const packageInstalled = dpkgResult.status === 0 && isDpkgInstalled(dpkgResult.stdout || "");

    // Extract version from dpkg output
    let version: string | null = null;
    if (packageInstalled && dpkgResult.stdout) {
      const versionMatch = dpkgResult.stdout.match(/^Version:\s*(.+)$/m);
      if (versionMatch) version = versionMatch[1].trim();
    }

    // Check if config exists
    const configExists = existsSync("/etc/roundcube/config.inc.php");

    // Check if Apache integration is enabled
    const apacheEnabled =
      existsSync("/etc/apache2/conf-enabled/roundcube.conf") ||
      existsSync("/etc/apache2/sites-enabled/roundcube.conf");

    // Check Apache status
    let apacheStatus: "running" | "stopped" | "unknown" = "unknown";
    try {
      const statusResult = spawnSync("/usr/bin/systemctl", ["is-active", "apache2"], {
        encoding: "utf8",
        timeout: 5000,
      });
      const stdout = (statusResult.stdout || "").trim();
      if (stdout === "active") apacheStatus = "running";
      else if (stdout === "inactive" || stdout === "dead") apacheStatus = "stopped";
    } catch { /* ignore */ }

    // Derive webmail domain from Postfix hostname
    let domain: string | null = null;
    const hostname = readPostfixSetting("myhostname");
    if (hostname && /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(hostname) && hostname.length <= 253) {
      domain = hostname;
    }

    // Installed = all phases completed (aligned with POST idempotency guard)
    const installed = packageInstalled && configExists && apacheEnabled && apacheStatus === "running";

    // Build webmail URL
    let url: string | null = null;
    if (installed && domain) {
      url = `https://${domain}/roundcube`;
    }

    return NextResponse.json({
      installed,
      url,
      status: installed ? apacheStatus : "unknown",
      version,
      domain,
    });
  } catch (error) {
    console.error("Error checking webmail status:", error);
    return NextResponse.json(
      { error: "Failed to check webmail status" },
      { status: 500 }
    );
  }
}

// ── POST - Setup Roundcube webmail ──

let setupInProgress = false;

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  if (setupInProgress) {
    return NextResponse.json(
      { error: "Webmail setup is already in progress" },
      { status: 409 }
    );
  }
  setupInProgress = true;

  try {
    // Idempotency guard: only block re-setup if ALL phases completed successfully.
    // If a partial failure left packages installed but Apache not configured/running,
    // allow retry so the admin can complete the setup without manual intervention.
    const dpkgCheck = spawnSync("/usr/bin/dpkg", ["-s", "roundcube"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const configExists = existsSync("/etc/roundcube/config.inc.php");
    const apacheConfEnabled =
      existsSync("/etc/apache2/conf-enabled/roundcube.conf") ||
      existsSync("/etc/apache2/sites-enabled/roundcube.conf");
    const apacheCheck = spawnSync("/usr/bin/systemctl", ["is-active", "apache2"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const apacheRunning = (apacheCheck.stdout || "").trim() === "active";

    if (dpkgCheck.status === 0 && isDpkgInstalled(dpkgCheck.stdout || "") && configExists && apacheConfEnabled && apacheRunning) {
      return NextResponse.json(
        { error: "Roundcube is already installed and running" },
        { status: 409 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { domain, adminEmail } = body as { domain?: unknown; adminEmail?: unknown };

    // Validate domain
    if (!domain || typeof domain !== "string") {
      return NextResponse.json({ error: "Domain is required" }, { status: 400 });
    }
    if (domain.length > 253 || !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(domain)) {
      return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
    }

    // Validate admin email
    if (!adminEmail || typeof adminEmail !== "string") {
      return NextResponse.json({ error: "Admin email is required" }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(adminEmail)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // ── Phase 1: Install packages ──

    const packages = ["roundcube", "roundcube-mysql", "roundcube-plugins-extra"];

    for (const pkg of packages) {
      const result = spawnSync(
        "/usr/bin/sudo",
        ["/usr/bin/apt-get", "install", "-y", "--no-install-recommends", pkg],
        {
          encoding: "utf8",
          timeout: 300000,
          env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
        }
      );
      if (result.status !== 0) {
        console.error(`Failed to install ${pkg}:`, result.stderr);
        return NextResponse.json(
          { error: `Failed to install package: ${pkg}` },
          { status: 500 }
        );
      }
    }

    // ── Phase 2: Generate Roundcube config ──

    const config = getConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Server configuration not found. Complete the setup wizard first." },
        { status: 500 }
      );
    }

    const dbHost = config.database.host || "localhost";

    // Validate DB host (alphanumeric, dots, hyphens only)
    if (!/^[a-zA-Z0-9._-]+$/.test(dbHost)) {
      return NextResponse.json(
        { error: "Invalid database host in configuration" },
        { status: 500 }
      );
    }

    // Dedicated Roundcube DB user (isolated from the CeyMail application user)
    const rcDbUser = "roundcube";
    const rcDbPassword = generateDbPassword();

    // Assert password is SQL-safe (alphanumeric only, no quotes/backslashes)
    if (!/^[A-Za-z0-9]+$/.test(rcDbPassword)) {
      return NextResponse.json(
        { error: "Internal error: generated password contains unsafe characters" },
        { status: 500 }
      );
    }
    const dbName = "roundcube";
    const desKey = generateDesKey();
    const escapedDomain = phpEscape(domain);
    const escapedEmail = phpEscape(adminEmail);

    const roundcubeConfig = `<?php

// CeyMail Mission Control - Roundcube Configuration
// Auto-generated - do not edit manually

// Database
$config['db_dsnw'] = 'mysql://${dsnEncode(rcDbUser)}:${dsnEncode(rcDbPassword)}@${dsnEncode(dbHost)}/${dsnEncode(dbName)}';

// IMAP
$config['imap_host'] = 'ssl://${escapedDomain}:993';
$config['imap_conn_options'] = array(
  'ssl' => array(
    'verify_peer' => true,
    'verify_peer_name' => true,
    'allow_self_signed' => false,
  ),
);

// SMTP
$config['smtp_host'] = 'tls://${escapedDomain}:587';
$config['smtp_port'] = 587;
$config['smtp_conn_options'] = array(
  'ssl' => array(
    'verify_peer' => true,
    'verify_peer_name' => true,
    'allow_self_signed' => false,
  ),
);

// System
$config['support_url'] = 'mailto:${escapedEmail}';
$config['product_name'] = 'CeyMail Webmail';
$config['des_key'] = '${phpEscape(desKey)}';
$config['language'] = 'en_US';
$config['skin'] = 'elastic';
$config['plugins'] = array('archive', 'zipdownload');

// Security
$config['enable_installer'] = false;
$config['login_autocomplete'] = 2;
$config['ip_check'] = true;
$config['use_https'] = true;

// UI
$config['draft_autosave'] = 120;
$config['mime_param_folding'] = 0;
`;

    // Create Roundcube database
    const dbCreateResult = spawnSync(
      "/usr/bin/sudo",
      ["/usr/bin/mysql", "-e", `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`],
      { encoding: "utf8", timeout: 10000 }
    );
    if (dbCreateResult.status !== 0) {
      console.error("Failed to create Roundcube database:", dbCreateResult.stderr);
      return NextResponse.json(
        { error: "Failed to create Roundcube database" },
        { status: 500 }
      );
    }

    // Create dedicated Roundcube database user with isolated credentials
    const userSetupResult = spawnSync(
      "/usr/bin/sudo",
      ["/usr/bin/mysql", "-e",
        `CREATE USER IF NOT EXISTS '${rcDbUser}'@'localhost' IDENTIFIED BY '${rcDbPassword}'; ` +
        `ALTER USER '${rcDbUser}'@'localhost' IDENTIFIED BY '${rcDbPassword}'; ` +
        `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${rcDbUser}'@'localhost'; ` +
        `FLUSH PRIVILEGES;`
      ],
      { encoding: "utf8", timeout: 10000 }
    );
    if (userSetupResult.status !== 0) {
      console.error("Failed to setup Roundcube database user:", userSetupResult.stderr);
      return NextResponse.json(
        { error: "Failed to configure Roundcube database user" },
        { status: 500 }
      );
    }

    // Write config
    const writeResult = sudoWriteFile("/etc/roundcube/config.inc.php", roundcubeConfig);
    if (!writeResult.ok) {
      console.error("Failed to write Roundcube config:", writeResult.error);
      return NextResponse.json(
        { error: "Failed to write Roundcube configuration" },
        { status: 500 }
      );
    }

    // ── Phase 3: Initialize database schema (before Apache exposes Roundcube) ──

    const schemaPath = "/usr/share/roundcube/SQL/mysql.initial.sql";
    if (existsSync(schemaPath)) {
      try {
        const schemaContent = readFileSync(schemaPath, "utf8");
        const schemaResult = spawnSync(
          "/usr/bin/sudo",
          ["/usr/bin/mysql", dbName],
          { input: schemaContent, encoding: "utf8", timeout: 30000 }
        );
        if (schemaResult.status !== 0) {
          console.error("Failed to initialize Roundcube schema:", schemaResult.stderr);
          // Non-fatal: schema may already be initialized by Debian package
        }
      } catch {
        // Non-fatal: schema may already be initialized by package
      }
    }

    // Verify schema AND roundcube user access in one shot (validates user exists,
    // password works, grants applied, and schema is accessible as the runtime user)
    const verifySchema = spawnSync(
      "/usr/bin/mysql",
      ["-u", rcDbUser, `-p${rcDbPassword}`, "-e", `SELECT 1 FROM \`${dbName}\`.users LIMIT 0`],
      { encoding: "utf8", timeout: 10000 }
    );
    if (verifySchema.status !== 0) {
      console.error("Roundcube database verification failed:", verifySchema.stderr);
      return NextResponse.json(
        { error: "Failed to verify Roundcube database access" },
        { status: 500 }
      );
    }

    // ── Phase 4: Enable Roundcube in Apache ──

    const a2enResult = spawnSync("/usr/bin/sudo", ["/usr/sbin/a2enconf", "roundcube"], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (a2enResult.status !== 0) {
      console.error("Failed to enable Roundcube Apache config:", a2enResult.stderr);
      return NextResponse.json(
        { error: "Failed to enable Roundcube in Apache" },
        { status: 500 }
      );
    }

    // ── Phase 5: Restart Apache ──

    const restartResult = spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "restart", "apache2"], {
      encoding: "utf8",
      timeout: 30000,
    });
    if (restartResult.status !== 0) {
      console.error("Failed to restart Apache:", restartResult.stderr);
      return NextResponse.json(
        { error: "Failed to restart Apache after configuration" },
        { status: 500 }
      );
    }

    const webmailUrl = `https://${domain}/roundcube`;

    return NextResponse.json({
      success: true,
      webmailUrl,
      dnsInstructions: [
        `Ensure A record for ${domain} points to your server IP`,
        `Verify SSL certificate covers ${domain}`,
      ],
    }, { status: 201 });
  } catch (error) {
    console.error("Error setting up webmail:", error);
    return NextResponse.json(
      { error: "Failed to setup webmail" },
      { status: 500 }
    );
  } finally {
    setupInProgress = false;
  }
}
