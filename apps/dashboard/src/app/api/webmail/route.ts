import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import crypto from "crypto";
import { requireAdmin } from "@/lib/api/helpers";
import { getConfig } from "@/lib/config/config";

// ── Types ──

type WebServer = "nginx" | "apache2";

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

/** Write a file via sudo tee, restricted to allowed directories */
function sudoWriteFile(filePath: string, content: string): { ok: boolean; error?: string } {
  const path = resolve(filePath);
  const allowedPrefixes = ["/etc/roundcube/", "/etc/nginx/sites-available/"];
  if (!allowedPrefixes.some((p) => path.startsWith(p))) {
    return { ok: false, error: `Path ${path} is not under an allowed directory` };
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

// ── Web Server Detection ──

/** Detect the active web server: prefer whichever is running, then enabled */
function detectWebServer(): WebServer | null {
  const SYSTEMCTL = "/usr/bin/systemctl";

  const nginxActive = spawnSync(SYSTEMCTL, ["is-active", "nginx"], { encoding: "utf8", timeout: 3000 });
  const apacheActive = spawnSync(SYSTEMCTL, ["is-active", "apache2"], { encoding: "utf8", timeout: 3000 });

  const nginxIsActive = (nginxActive.stdout || "").trim() === "active";
  const apacheIsActive = (apacheActive.stdout || "").trim() === "active";

  if (nginxIsActive && !apacheIsActive) return "nginx";
  if (apacheIsActive && !nginxIsActive) return "apache2";
  if (nginxIsActive && apacheIsActive) return "nginx";

  // Neither active — check which is enabled
  const nginxEnabled = spawnSync(SYSTEMCTL, ["is-enabled", "nginx"], { encoding: "utf8", timeout: 3000 });
  const apacheEnabled = spawnSync(SYSTEMCTL, ["is-enabled", "apache2"], { encoding: "utf8", timeout: 3000 });

  if ((nginxEnabled.stdout || "").trim() === "enabled") return "nginx";
  if ((apacheEnabled.stdout || "").trim() === "enabled") return "apache2";

  return null;
}

/** Detect the PHP-FPM socket path from /run/php/ */
function detectPhpFpmSocket(): string | null {
  try {
    const files = readdirSync("/run/php/");
    const socket = files.find((f) => /^php[\d.]+-fpm\.sock$/.test(f));
    return socket ? `/run/php/${socket}` : null;
  } catch {
    return null;
  }
}

/** Detect the installed PHP version (e.g. "8.3") */
function detectPhpVersion(): string | null {
  const result = spawnSync("/usr/bin/php", ["-r", "echo PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (result.status !== 0) return null;
  const version = (result.stdout || "").trim();
  return /^\d+\.\d+$/.test(version) ? version : null;
}

/** Check if the Roundcube web server config is enabled for the given server */
function isWebServerConfigEnabled(webServer: WebServer): boolean {
  if (webServer === "nginx") {
    return existsSync("/etc/nginx/sites-enabled/roundcube");
  }
  return existsSync("/etc/apache2/conf-enabled/roundcube.conf") ||
         existsSync("/etc/apache2/sites-enabled/roundcube.conf");
}

/** Check if the given web server service is running */
function isWebServerRunning(webServer: WebServer): boolean {
  const result = spawnSync("/usr/bin/systemctl", ["is-active", webServer], {
    encoding: "utf8",
    timeout: 5000,
  });
  return (result.stdout || "").trim() === "active";
}

// ── GET - Check Roundcube installation status ──

export async function GET() {
  try {
    const webServer = detectWebServer();

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

    // Check web server integration (adapts to whichever server is active)
    const webServerConfigured = webServer ? isWebServerConfigEnabled(webServer) : false;
    const webServerRunning = webServer ? isWebServerRunning(webServer) : false;

    // Derive webmail domain from Postfix hostname
    let domain: string | null = null;
    const hostname = readPostfixSetting("myhostname");
    if (hostname && /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(hostname) && hostname.length <= 253) {
      domain = hostname;
    }

    // Installed = all phases completed
    const installed = packageInstalled && configExists && webServerConfigured && webServerRunning;

    // Build webmail URL based on the web server type
    let url: string | null = null;
    if (installed && domain) {
      url = webServer === "nginx" ? `https://${domain}` : `https://${domain}/roundcube`;
    }

    return NextResponse.json({
      installed,
      url,
      status: installed ? (webServerRunning ? "running" : "stopped") : "unknown",
      version,
      domain,
      webServer: webServer ?? "unknown",
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
    // Detect web server
    const webServer = detectWebServer();
    if (!webServer) {
      return NextResponse.json(
        { error: "No supported web server detected. Install and start Nginx or Apache first." },
        { status: 400 }
      );
    }

    // Idempotency guard: only block re-setup if ALL phases completed.
    // Partial failures allow retry so the admin can complete setup.
    const dpkgCheck = spawnSync("/usr/bin/dpkg", ["-s", "roundcube"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const configExists = existsSync("/etc/roundcube/config.inc.php");
    const webServerConfigured = isWebServerConfigEnabled(webServer);
    const webServerRunning = isWebServerRunning(webServer);

    if (dpkgCheck.status === 0 && isDpkgInstalled(dpkgCheck.stdout || "") && configExists && webServerConfigured && webServerRunning) {
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

    // ── Phase 1: Install PHP-FPM (Nginx only — Apache uses mod_php from roundcube package) ──

    if (webServer === "nginx") {
      const phpPackages = [
        "php-fpm", "php-mysql", "php-gd", "php-imap",
        "php-curl", "php-xml", "php-mbstring", "php-intl",
      ];
      for (const pkg of phpPackages) {
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
    }

    // ── Phase 2: Install Roundcube packages ──

    const rcPackages = ["roundcube", "roundcube-mysql", "roundcube-plugins"];
    for (const pkg of rcPackages) {
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

    // ── Phase 3: Start/enable PHP-FPM (Nginx only) ──

    let fpmSocket: string | null = null;

    if (webServer === "nginx") {
      const phpVersion = detectPhpVersion();
      if (!phpVersion) {
        return NextResponse.json(
          { error: "PHP installed but version could not be detected" },
          { status: 500 }
        );
      }

      const fpmService = `php${phpVersion}-fpm`;

      // Enable and start PHP-FPM
      spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "enable", fpmService], {
        encoding: "utf8",
        timeout: 10000,
      });
      const startResult = spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "start", fpmService], {
        encoding: "utf8",
        timeout: 30000,
      });
      if (startResult.status !== 0) {
        console.error(`Failed to start ${fpmService}:`, startResult.stderr);
        return NextResponse.json(
          { error: "Failed to start PHP-FPM service" },
          { status: 500 }
        );
      }

      // Detect socket path
      fpmSocket = `/run/php/php${phpVersion}-fpm.sock`;
      if (!existsSync(fpmSocket)) {
        fpmSocket = detectPhpFpmSocket();
      }
      if (!fpmSocket) {
        return NextResponse.json(
          { error: "PHP-FPM started but socket not found" },
          { status: 500 }
        );
      }
    }

    // ── Phase 4: Generate Roundcube config ──

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

    // ── Phase 5: Create database and user ──

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

    // Write Roundcube config
    const writeResult = sudoWriteFile("/etc/roundcube/config.inc.php", roundcubeConfig);
    if (!writeResult.ok) {
      console.error("Failed to write Roundcube config:", writeResult.error);
      return NextResponse.json(
        { error: "Failed to write Roundcube configuration" },
        { status: 500 }
      );
    }

    // ── Phase 6: Initialize database schema ──

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

    // ── Phase 7: Configure web server ──

    let webmailUrl: string;

    if (webServer === "nginx") {
      // Generate Nginx server block
      const nginxConfig = [
        "# CeyMail Mission Control - Roundcube Webmail",
        "# Auto-generated - do not edit manually",
        "",
        "server {",
        "    listen 80;",
        "    listen [::]:80;",
        `    server_name ${domain};`,
        "",
        "    root /var/lib/roundcube/public_html;",
        "    index index.php;",
        "",
        "    access_log /var/log/nginx/roundcube.access.log;",
        "    error_log  /var/log/nginx/roundcube.error.log;",
        "",
        "    location / {",
        "        try_files $uri $uri/ /index.php$is_args$args;",
        "    }",
        "",
        "    location ~ \\.php$ {",
        "        try_files $uri =404;",
        `        fastcgi_pass unix:${fpmSocket};`,
        "        fastcgi_index index.php;",
        "        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;",
        "        include fastcgi_params;",
        "    }",
        "",
        "    location ~ ^/(config|temp|logs|bin|SQL)/ {",
        "        deny all;",
        "    }",
        "",
        "    location ~ ^/(README|INSTALL|LICENSE|CHANGELOG|UPGRADING)$ {",
        "        deny all;",
        "    }",
        "",
        "    location ~ /\\. {",
        "        deny all;",
        "        access_log off;",
        "        log_not_found off;",
        "    }",
        "}",
        "",
      ].join("\n");

      // Write Nginx config
      const nginxWriteResult = sudoWriteFile("/etc/nginx/sites-available/roundcube", nginxConfig);
      if (!nginxWriteResult.ok) {
        console.error("Failed to write Nginx config:", nginxWriteResult.error);
        return NextResponse.json(
          { error: "Failed to write Nginx configuration for Roundcube" },
          { status: 500 }
        );
      }

      // Symlink to sites-enabled
      const lnResult = spawnSync(
        "/usr/bin/sudo",
        ["/usr/bin/ln", "-sf", "/etc/nginx/sites-available/roundcube", "/etc/nginx/sites-enabled/roundcube"],
        { encoding: "utf8", timeout: 10000 }
      );
      if (lnResult.status !== 0) {
        console.error("Failed to enable Nginx site:", lnResult.stderr);
        return NextResponse.json(
          { error: "Failed to enable Roundcube Nginx site" },
          { status: 500 }
        );
      }

      // Test Nginx config before reloading
      const testResult = spawnSync(
        "/usr/bin/sudo",
        ["/usr/sbin/nginx", "-t"],
        { encoding: "utf8", timeout: 10000 }
      );
      if (testResult.status !== 0) {
        console.error("Nginx config test failed:", testResult.stderr);
        // Roll back the broken config
        spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/sites-enabled/roundcube"], {
          encoding: "utf8",
          timeout: 5000,
        });
        return NextResponse.json(
          { error: "Nginx configuration test failed. Config has been rolled back." },
          { status: 500 }
        );
      }

      // Reload Nginx
      const reloadResult = spawnSync(
        "/usr/bin/sudo",
        ["/usr/bin/systemctl", "reload", "nginx"],
        { encoding: "utf8", timeout: 30000 }
      );
      if (reloadResult.status !== 0) {
        console.error("Failed to reload Nginx:", reloadResult.stderr);
        return NextResponse.json(
          { error: "Failed to reload Nginx after configuration" },
          { status: 500 }
        );
      }

      webmailUrl = `https://${domain}`;

    } else {
      // ── Apache flow ──

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

      webmailUrl = `https://${domain}/roundcube`;
    }

    return NextResponse.json({
      success: true,
      webmailUrl,
      webServer,
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
