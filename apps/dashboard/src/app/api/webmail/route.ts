import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync, mkdirSync, rmdirSync, renameSync, statSync } from "fs";
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
  if (/[\r\n]/.test(s)) throw new Error("Newline in PHP string value");
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
  const allowedPaths = ["/etc/roundcube/config.inc.php", "/etc/nginx/snippets/roundcube-webmail.conf", "/etc/nginx/sites-available/roundcube-webmail"];
  if (!allowedPaths.includes(path)) {
    return { ok: false, error: `Path ${path} is not an allowed file` };
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
    const socket = files.find((f) => /^php\d+\.\d+-fpm\.sock$/.test(f));
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
    return existsSync("/etc/nginx/snippets/roundcube-webmail.conf") ||
           existsSync("/etc/nginx/sites-enabled/roundcube-webmail");
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

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

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

    // Installed = package present, config written, and web server config enabled
    const installed = packageInstalled && configExists && webServerConfigured;

    // Build webmail URL based on the web server type (detect SSL cert for scheme)
    let url: string | null = null;
    const hasSSL = domain ? existsSync(`/etc/letsencrypt/renewal/${domain}.conf`) : false;
    if (installed && domain) {
      const scheme = hasSSL ? "https" : "http";
      url = `${scheme}://${domain}/webmail`;
    }

    // Detect if the Nginx config needs SSL reconfiguration:
    // SSL cert exists but the standalone server block doesn't listen on 443
    let needsReconfigure = false;
    if (installed && hasSSL && webServer === "nginx") {
      try {
        const serverBlockContent = readFileSync("/etc/nginx/sites-available/roundcube-webmail", "utf8");
        needsReconfigure = !serverBlockContent.includes("listen 443");
      } catch {
        // No standalone block — snippet may be included in a config that already has SSL
        needsReconfigure = false;
      }
    }

    return NextResponse.json({
      installed,
      url,
      status: installed ? (webServerRunning ? "running" : "stopped") : "unknown",
      version,
      domain,
      webServer: webServer ?? "unknown",
      needsReconfigure,
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

const SETUP_LOCK = "/var/lib/ceymail-mc/webmail-setup.lock";

function acquireSetupLock(): boolean {
  try {
    mkdirSync(SETUP_LOCK);
    return true;
  } catch {
    // Lock exists — check for staleness (crash left it behind)
    try {
      const stat = statSync(SETUP_LOCK);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs > 15 * 60 * 1000) {
        // Atomic reclaim: rename is atomic on POSIX — only one process wins
        const stale = SETUP_LOCK + ".stale." + process.pid;
        try {
          renameSync(SETUP_LOCK, stale);
          rmdirSync(stale);
        } catch {
          return false; // Another process beat us to the reclaim
        }
        try {
          mkdirSync(SETUP_LOCK);
          return true;
        } catch {
          return false; // Another process created the lock first
        }
      }
    } catch {
      // Can't stat or reclaim — treat as locked
    }
    return false;
  }
}

function releaseSetupLock(): void {
  try { rmdirSync(SETUP_LOCK); } catch { /* ignore */ }
}

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  if (!acquireSetupLock()) {
    return NextResponse.json(
      { error: "Webmail setup is already in progress" },
      { status: 409 }
    );
  }

  try {
    // Parse body first (needed for reconfigure flag check)
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { domain, adminEmail, reconfigure } = body as {
      domain?: unknown;
      adminEmail?: unknown;
      reconfigure?: boolean;
    };

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
    // When reconfigure=true, skip the guard and only regenerate web server config.
    const dpkgCheck = spawnSync("/usr/bin/dpkg", ["-s", "roundcube"], {
      encoding: "utf8",
      timeout: 5000,
    });
    const configExists = existsSync("/etc/roundcube/config.inc.php");
    const webServerConfigured = isWebServerConfigEnabled(webServer);
    const isFullyInstalled = dpkgCheck.status === 0 && isDpkgInstalled(dpkgCheck.stdout || "") && configExists && webServerConfigured;

    if (isFullyInstalled && !reconfigure) {
      return NextResponse.json(
        { error: "Roundcube is already installed and configured" },
        { status: 409 }
      );
    }

    // Validate domain
    if (!domain || typeof domain !== "string") {
      return NextResponse.json({ error: "Domain is required" }, { status: 400 });
    }
    const validatedDomain = (domain as string).trim().toLowerCase();
    if (validatedDomain.length > 253 || !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(validatedDomain)) {
      return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
    }

    // Validate individual label length (RFC 1035: max 63 octets per label)
    if (validatedDomain.split(".").some((label) => label.length > 63)) {
      return NextResponse.json({ error: "Domain label exceeds 63 characters" }, { status: 400 });
    }

    // Validate admin email
    if (!adminEmail || typeof adminEmail !== "string") {
      return NextResponse.json({ error: "Admin email is required" }, { status: 400 });
    }
    const validatedEmail = (adminEmail as string).trim().toLowerCase();
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(validatedEmail)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // ── Reconfigure mode: skip phases 1-6 and only regenerate web server config ──

    if (isFullyInstalled && reconfigure) {
      if (webServer !== "nginx") {
        return NextResponse.json(
          { error: "Reconfigure is only supported for Nginx" },
          { status: 400 }
        );
      }

      const fpmSocket = detectPhpFpmSocket();
      if (!fpmSocket) {
        return NextResponse.json(
          { error: "PHP-FPM socket not found" },
          { status: 500 }
        );
      }

      // Validate FPM socket path (defense-in-depth against path injection in Nginx config)
      if (!/^\/[a-zA-Z0-9._/-]+$/.test(fpmSocket) || fpmSocket.includes("..")) {
        return NextResponse.json(
          { error: "PHP-FPM socket path contains invalid characters" },
          { status: 500 }
        );
      }

      const hasSSL = existsSync(`/etc/letsencrypt/renewal/${validatedDomain}.conf`);

      // Regenerate the Nginx snippet
      const nginxSnippet = [
        "# CeyMail — Roundcube at /webmail (included in dashboard server block)",
        "# Auto-generated by Mission Control — do not edit manually",
        "",
        "location ^~ /webmail {",
        "    alias /var/lib/roundcube/public_html;",
        "    index index.php;",
        "    client_max_body_size 25m;",
        "",
        "    # Capture path after /webmail to resolve alias correctly for PHP-FPM",
        "    location ~ ^/webmail(/.*\\.php)$ {",
        "        alias /var/lib/roundcube/public_html$1;",
        `        fastcgi_pass unix:${fpmSocket};`,
        "        fastcgi_index index.php;",
        "        fastcgi_param SCRIPT_FILENAME /var/lib/roundcube/public_html$1;",
        ...(hasSSL ? ["        fastcgi_param HTTPS on;"] : []),
        "        include fastcgi_params;",
        "    }",
        "",
        "    location ~ ^/webmail/(config|temp|logs|bin|SQL)/ { deny all; }",
        "    location ~ ^/webmail/(README|INSTALL|LICENSE|CHANGELOG|UPGRADING)$ { deny all; }",
        "    location ~ /\\. { deny all; }",
        "}",
        "",
      ].join("\n");

      const snippetWriteResult = sudoWriteFile("/etc/nginx/snippets/roundcube-webmail.conf", nginxSnippet);
      if (!snippetWriteResult.ok) {
        return NextResponse.json(
          { error: "Failed to write Nginx snippet" },
          { status: 500 }
        );
      }

      // Remove old standalone server block so it can be regenerated with current SSL status
      spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/sites-enabled/roundcube-webmail"], {
        encoding: "utf8", timeout: 5000,
      });
      spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/sites-available/roundcube-webmail"], {
        encoding: "utf8", timeout: 5000,
      });

      // Clean up any legacy config
      spawnSync("/usr/bin/sudo", ["/usr/local/bin/ceymail-nginx-webmail", "cleanup-legacy"], {
        encoding: "utf8", timeout: 10000,
      });

      // Try to inject snippet into an existing Nginx config for the domain
      const includeResult = spawnSync(
        "/usr/bin/sudo",
        ["/usr/local/bin/ceymail-nginx-webmail", "add-include", validatedDomain],
        { encoding: "utf8", timeout: 10000 }
      );

      if (includeResult.status !== 0) {
        // No existing config — create standalone server block with current SSL status
        const sslCertPath = `/etc/letsencrypt/live/${validatedDomain}/fullchain.pem`;
        const sslKeyPath = `/etc/letsencrypt/live/${validatedDomain}/privkey.pem`;
        const domainHasSSL = existsSync(sslCertPath);

        const serverBlock = [
          "# CeyMail — Roundcube Webmail server block",
          "# Auto-generated by Mission Control — do not edit manually",
          "",
          "server {",
          "    listen 80;",
          "    listen [::]:80;",
          `    server_name ${validatedDomain};`,
          "",
          "    location /.well-known/acme-challenge/ {",
          "        root /var/www/html;",
          "    }",
          "",
          ...(domainHasSSL ? [
            "    location / {",
            "        return 301 https://$host$request_uri;",
            "    }",
            "}",
            "",
            "server {",
            "    listen 443 ssl http2;",
            "    listen [::]:443 ssl http2;",
            `    server_name ${validatedDomain};`,
            "",
            `    ssl_certificate ${sslCertPath};`,
            `    ssl_certificate_key ${sslKeyPath};`,
            "    include /etc/letsencrypt/options-ssl-nginx.conf;",
            "",
            "    include /etc/nginx/snippets/roundcube-webmail.conf;",
            "",
            "    location / {",
            "        return 404;",
            "    }",
            "}",
          ] : [
            "    include /etc/nginx/snippets/roundcube-webmail.conf;",
            "",
            "    location / {",
            "        return 404;",
            "    }",
            "}",
          ]),
          "",
        ].join("\n");

        const serverBlockResult = sudoWriteFile("/etc/nginx/sites-available/roundcube-webmail", serverBlock);
        if (!serverBlockResult.ok) {
          return NextResponse.json(
            { error: "Failed to write Nginx server block" },
            { status: 500 }
          );
        }

        // Enable the server block
        spawnSync(
          "/usr/bin/sudo",
          ["/usr/bin/ln", "-sf", "/etc/nginx/sites-available/roundcube-webmail", "/etc/nginx/sites-enabled/roundcube-webmail"],
          { encoding: "utf8", timeout: 5000 }
        );
      }

      // Test Nginx config
      const testResult = spawnSync("/usr/bin/sudo", ["/usr/sbin/nginx", "-t"], {
        encoding: "utf8", timeout: 10000,
      });
      if (testResult.status !== 0) {
        console.error("Nginx config test failed during reconfigure:", testResult.stderr);
        // Roll back: remove include from existing configs + standalone server block + snippet
        spawnSync("/usr/bin/sudo", ["/usr/local/bin/ceymail-nginx-webmail", "remove-include"], {
          encoding: "utf8", timeout: 10000,
        });
        spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/sites-enabled/roundcube-webmail"], {
          encoding: "utf8", timeout: 5000,
        });
        spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/sites-available/roundcube-webmail"], {
          encoding: "utf8", timeout: 5000,
        });
        spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/snippets/roundcube-webmail.conf"], {
          encoding: "utf8", timeout: 5000,
        });
        return NextResponse.json(
          { error: "Nginx configuration test failed during reconfigure. Config has been rolled back." },
          { status: 500 }
        );
      }

      // Reload Nginx
      const reloadResult = spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "reload", "nginx"], {
        encoding: "utf8", timeout: 30000,
      });
      if (reloadResult.status !== 0) {
        return NextResponse.json(
          { error: "Failed to reload Nginx after reconfigure" },
          { status: 500 }
        );
      }

      const webmailUrl = `${hasSSL ? "https" : "http"}://${validatedDomain}/webmail`;
      return NextResponse.json({
        success: true,
        webmailUrl,
        webServer: "nginx",
        reconfigured: true,
        dnsInstructions: [],
      });
    }

    // ── Phase 1: Install PHP-FPM (Nginx only — Apache uses mod_php from roundcube package) ──

    if (webServer === "nginx") {
      const phpPackages = [
        "php-fpm", "php-mysql", "php-gd", "php-imap",
        "php-curl", "php-xml", "php-mbstring", "php-intl", "php-zip",
      ];
      for (const pkg of phpPackages) {
        const result = spawnSync(
          "/usr/bin/sudo",
          ["/usr/bin/apt-get", "install", "-y", "--no-install-recommends", pkg],
          {
            encoding: "utf8",
            timeout: 300000,
            env: { DEBIAN_FRONTEND: "noninteractive", PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/root", TERM: "dumb" } as unknown as NodeJS.ProcessEnv,
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
          env: { DEBIAN_FRONTEND: "noninteractive", PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: "/root", TERM: "dumb" } as unknown as NodeJS.ProcessEnv,
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

      // Validate FPM socket path (defense-in-depth against path injection in Nginx config)
      if (!/^\/[a-zA-Z0-9._/-]+$/.test(fpmSocket) || fpmSocket.includes("..")) {
        return NextResponse.json(
          { error: "PHP-FPM socket path contains invalid characters" },
          { status: 500 }
        );
      }
    }

    // Detect SSL before generating configs (used in Roundcube config and Nginx snippet)
    const hasSSL = existsSync(`/etc/letsencrypt/renewal/${validatedDomain}.conf`);

    // ── Phase 4: Generate Roundcube config ──

    const config = getConfig();
    if (!config?.database) {
      return NextResponse.json(
        { error: "Server configuration not found or incomplete. Complete the setup wizard first." },
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
    const escapedDomain = phpEscape(validatedDomain);
    const escapedEmail = phpEscape(validatedEmail);

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
$config['use_https'] = ${hasSSL ? "true" : "false"};

// UI
$config['draft_autosave'] = 120;
$config['mime_param_folding'] = 0;
`;

    // ── Phase 5: Create database and user ──

    const dbCreateResult = spawnSync(
      "/usr/bin/sudo",
      ["/usr/local/bin/ceymail-roundcube-db", "create-db"],
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
    // Password is passed via stdin to avoid exposure in process listing
    const userSetupResult = spawnSync(
      "/usr/bin/sudo",
      ["/usr/local/bin/ceymail-roundcube-db", "setup-user"],
      { input: rcDbPassword + "\n", encoding: "utf8", timeout: 10000 }
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

    // Restrict config file permissions (contains DB password in DSN)
    const chmodResult = spawnSync("/usr/bin/sudo", ["/usr/bin/chmod", "640", "/etc/roundcube/config.inc.php"], {
      encoding: "utf8", timeout: 5000,
    });
    const chownResult = spawnSync("/usr/bin/sudo", ["/usr/bin/chown", "root:www-data", "/etc/roundcube/config.inc.php"], {
      encoding: "utf8", timeout: 5000,
    });
    if (chmodResult.status !== 0 || chownResult.status !== 0) {
      console.error("Failed to set Roundcube config permissions:", chmodResult.stderr, chownResult.stderr);
      return NextResponse.json(
        { error: "Failed to secure Roundcube configuration file permissions" },
        { status: 500 }
      );
    }

    // ── Phase 6: Initialize database schema ──
    // The wrapper script reads from the hardcoded path /usr/share/roundcube/SQL/mysql.initial.sql

    const schemaResult = spawnSync(
      "/usr/bin/sudo",
      ["/usr/local/bin/ceymail-roundcube-db", "import-schema"],
      { encoding: "utf8", timeout: 30000 }
    );
    if (schemaResult.status !== 0) {
      const schemaStderr = (schemaResult.stderr || "").toLowerCase();
      const isAlreadyExists = schemaStderr.includes("already exists");
      if (!isAlreadyExists) {
        console.error("Failed to initialize Roundcube schema:", schemaResult.stderr);
        return NextResponse.json(
          { error: "Failed to initialize Roundcube database schema" },
          { status: 500 }
        );
      }
      // Tables already exist from a previous run — safe to continue
    }

    // Verify schema AND roundcube user access in one shot (validates user exists,
    // password works, grants applied, and schema is accessible as the runtime user).
    // Password passed via env var to avoid exposure in process listing.
    const verifySchema = spawnSync(
      "/usr/bin/mysql",
      ["-u", rcDbUser, "-e", `SELECT 1 FROM \`${dbName}\`.users LIMIT 0`],
      { encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/usr/sbin:/bin:/sbin", HOME: "/tmp", MYSQL_PWD: rcDbPassword } as unknown as NodeJS.ProcessEnv }
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
      // Generate Nginx location snippet (included in the dashboard server block)
      const nginxSnippet = [
        "# CeyMail — Roundcube at /webmail (included in dashboard server block)",
        "# Auto-generated by Mission Control — do not edit manually",
        "",
        "location ^~ /webmail {",
        "    alias /var/lib/roundcube/public_html;",
        "    index index.php;",
        "    client_max_body_size 25m;",
        "",
        "    # Capture path after /webmail to resolve alias correctly for PHP-FPM",
        "    location ~ ^/webmail(/.*\\.php)$ {",
        "        alias /var/lib/roundcube/public_html$1;",
        `        fastcgi_pass unix:${fpmSocket};`,
        "        fastcgi_index index.php;",
        "        fastcgi_param SCRIPT_FILENAME /var/lib/roundcube/public_html$1;",
        ...(hasSSL ? ["        fastcgi_param HTTPS on;"] : []),
        "        include fastcgi_params;",
        "    }",
        "",
        "    location ~ ^/webmail/(config|temp|logs|bin|SQL)/ { deny all; }",
        "    location ~ ^/webmail/(README|INSTALL|LICENSE|CHANGELOG|UPGRADING)$ { deny all; }",
        "    location ~ /\\. { deny all; }",
        "}",
        "",
      ].join("\n");

      // Write snippet file
      const snippetWriteResult = sudoWriteFile("/etc/nginx/snippets/roundcube-webmail.conf", nginxSnippet);
      if (!snippetWriteResult.ok) {
        console.error("Failed to write Nginx snippet:", snippetWriteResult.error);
        return NextResponse.json(
          { error: "Failed to write Nginx configuration for Roundcube" },
          { status: 500 }
        );
      }

      // Clean up any legacy standalone server block from previous setup
      spawnSync(
        "/usr/bin/sudo",
        ["/usr/local/bin/ceymail-nginx-webmail", "cleanup-legacy"],
        { encoding: "utf8", timeout: 10000 }
      );

      // Try to inject the snippet include into an existing Nginx config for the mail domain.
      // If no config exists (e.g. mail domain differs from dashboard domain), create a
      // standalone server block for the mail domain that includes the snippet.
      const includeResult = spawnSync(
        "/usr/bin/sudo",
        ["/usr/local/bin/ceymail-nginx-webmail", "add-include", validatedDomain],
        { encoding: "utf8", timeout: 10000 }
      );

      if (includeResult.status !== 0) {
        // No existing Nginx config for the mail domain — create a standalone server block
        const sslCertPath = `/etc/letsencrypt/live/${validatedDomain}/fullchain.pem`;
        const sslKeyPath = `/etc/letsencrypt/live/${validatedDomain}/privkey.pem`;
        const domainHasSSL = existsSync(sslCertPath);

        const serverBlock = [
          "# CeyMail — Roundcube Webmail server block",
          "# Auto-generated by Mission Control — do not edit manually",
          "",
          "server {",
          "    listen 80;",
          "    listen [::]:80;",
          `    server_name ${validatedDomain};`,
          "",
          "    location /.well-known/acme-challenge/ {",
          "        root /var/www/html;",
          "    }",
          "",
          ...(domainHasSSL ? [
            "    location / {",
            "        return 301 https://$host$request_uri;",
            "    }",
            "}",
            "",
            "server {",
            "    listen 443 ssl http2;",
            "    listen [::]:443 ssl http2;",
            `    server_name ${validatedDomain};`,
            "",
            `    ssl_certificate ${sslCertPath};`,
            `    ssl_certificate_key ${sslKeyPath};`,
            "    include /etc/letsencrypt/options-ssl-nginx.conf;",
            "",
            "    include /etc/nginx/snippets/roundcube-webmail.conf;",
            "",
            "    location / {",
            "        return 404;",
            "    }",
            "}",
          ] : [
            "    include /etc/nginx/snippets/roundcube-webmail.conf;",
            "",
            "    location / {",
            "        return 404;",
            "    }",
            "}",
          ]),
          "",
        ].join("\n");

        const serverBlockResult = sudoWriteFile("/etc/nginx/sites-available/roundcube-webmail", serverBlock);
        if (!serverBlockResult.ok) {
          console.error("Failed to write Nginx server block:", serverBlockResult.error);
          spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/snippets/roundcube-webmail.conf"], {
            encoding: "utf8", timeout: 5000,
          });
          return NextResponse.json(
            { error: "Failed to write Nginx server block for webmail" },
            { status: 500 }
          );
        }

        // Enable the server block
        const lnResult = spawnSync(
          "/usr/bin/sudo",
          ["/usr/bin/ln", "-sf", "/etc/nginx/sites-available/roundcube-webmail", "/etc/nginx/sites-enabled/roundcube-webmail"],
          { encoding: "utf8", timeout: 5000 }
        );
        if (lnResult.status !== 0) {
          console.error("Failed to enable webmail server block:", lnResult.stderr);
          spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/sites-available/roundcube-webmail"], {
            encoding: "utf8", timeout: 5000,
          });
          spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/snippets/roundcube-webmail.conf"], {
            encoding: "utf8", timeout: 5000,
          });
          return NextResponse.json(
            { error: "Failed to enable Roundcube Nginx server block" },
            { status: 500 }
          );
        }
      }

      // Test Nginx config before reloading
      const testResult = spawnSync(
        "/usr/bin/sudo",
        ["/usr/sbin/nginx", "-t"],
        { encoding: "utf8", timeout: 10000 }
      );
      if (testResult.status !== 0) {
        console.error("Nginx config test failed:", testResult.stderr);
        // Roll back: remove include from existing configs + standalone server block + snippet
        spawnSync("/usr/bin/sudo", ["/usr/local/bin/ceymail-nginx-webmail", "remove-include"], {
          encoding: "utf8", timeout: 10000,
        });
        spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/sites-enabled/roundcube-webmail"], {
          encoding: "utf8", timeout: 5000,
        });
        spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/sites-available/roundcube-webmail"], {
          encoding: "utf8", timeout: 5000,
        });
        spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/nginx/snippets/roundcube-webmail.conf"], {
          encoding: "utf8", timeout: 5000,
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

      webmailUrl = `${hasSSL ? "https" : "http"}://${validatedDomain}/webmail`;

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

      // Test Apache config before restart to avoid bringing down the web server
      const apacheTestResult = spawnSync("/usr/bin/sudo", ["/usr/sbin/apache2ctl", "configtest"], {
        encoding: "utf8",
        timeout: 10000,
      });
      if (apacheTestResult.status !== 0) {
        console.error("Apache config test failed:", apacheTestResult.stderr);
        // Roll back the broken config and verify rollback succeeded
        const rollback = spawnSync("/usr/bin/sudo", ["/usr/sbin/a2disconf", "roundcube"], {
          encoding: "utf8",
          timeout: 5000,
        });
        const rolledBack = rollback.status === 0;
        return NextResponse.json(
          {
            error: rolledBack
              ? "Apache configuration test failed. Config has been rolled back."
              : "Apache configuration test failed. Automatic rollback also failed — run 'sudo a2disconf roundcube' manually.",
          },
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

      webmailUrl = `${hasSSL ? "https" : "http"}://${validatedDomain}/webmail`;
    }

    return NextResponse.json({
      success: true,
      webmailUrl,
      webServer,
      dnsInstructions: [
        `Verify SSL certificate covers ${validatedDomain}`,
      ],
    }, { status: 201 });
  } catch (error) {
    console.error("Error setting up webmail:", error);
    return NextResponse.json(
      { error: "Failed to setup webmail" },
      { status: 500 }
    );
  } finally {
    releaseSetupLock();
  }
}
