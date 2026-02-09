import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { requireAdmin } from "@/lib/api/helpers";

// Whitelist of allowed packages
const ALLOWED_PACKAGES = new Set([
  "apache2",
  "certbot",
  "python3-certbot-apache",
  "python3-certbot-nginx",
  "mariadb-server",
  "postfix",
  "postfix-mysql",
  "dovecot-core",
  "dovecot-imapd",
  "dovecot-lmtpd",
  "dovecot-mysql",
  "opendkim",
  "opendkim-tools",
  "spamassassin",
  "unbound",
  "rsyslog",
]);

// PHP packages that need version substitution
const PHP_PACKAGES = [
  "php{VER}",
  "php{VER}-mysql",
  "php{VER}-mbstring",
  "php{VER}-intl",
  "php{VER}-xml",
  "php{VER}-zip",
  "php{VER}-gd",
  "php{VER}-curl",
  "php{VER}-dom",
  "libapache2-mod-php{VER}",
];

// POST - Install a single package via apt-get
export async function POST(request: NextRequest) {
  try {
    const denied = requireAdmin(request);
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { package: pkgName } = body as { package?: string };

    if (!pkgName || typeof pkgName !== "string") {
      return NextResponse.json({ error: "Package name is required" }, { status: 400 });
    }

    // Validate package name format (only alphanumeric, dash, dot, plus)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(pkgName)) {
      return NextResponse.json({ error: "Invalid package name format" }, { status: 400 });
    }

    // Check if it's in the whitelist
    if (!ALLOWED_PACKAGES.has(pkgName)) {
      return NextResponse.json(
        { error: `Package '${pkgName}' is not in the allowed list` },
        { status: 400 }
      );
    }

    // Install the package using sudo apt-get
    const result = spawnSync(
      "/usr/bin/sudo",
      ["/usr/bin/apt-get", "install", "-y", "--no-install-recommends", pkgName],
      {
        encoding: "utf8",
        timeout: 300000, // 5 min timeout per package
        env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
      }
    );

    const output = ((result.stdout || "") + (result.stderr || "")).slice(-500);

    if (result.status === 0) {
      return NextResponse.json({
        name: pkgName,
        status: "installed",
        output,
      });
    }

    console.error(`Failed to install ${pkgName}: exit ${result.status}`);
    return NextResponse.json({
      name: pkgName,
      status: "failed",
      output: output || "Installation failed",
    }, { status: 500 });
  } catch (error) {
    console.error("Error in package install:", error);
    return NextResponse.json(
      { error: "Failed to install package" },
      { status: 500 }
    );
  }
}

// Allowed PHP versions
const ALLOWED_PHP_VERSIONS = new Set(["7.4", "8.0", "8.1", "8.2", "8.3", "8.4"]);

// GET - Get list of PHP packages for a given version
export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const phpVersion = request.nextUrl.searchParams.get("phpVersion") || "8.2";

  // Validate version format and against allowlist
  if (!/^\d+\.\d+$/.test(phpVersion) || !ALLOWED_PHP_VERSIONS.has(phpVersion)) {
    return NextResponse.json({ error: "Invalid or unsupported PHP version" }, { status: 400 });
  }

  const phpPackages = PHP_PACKAGES.map((p) => p.replace(/\{VER\}/g, phpVersion));

  return NextResponse.json({
    packages: phpPackages,
  });
}
