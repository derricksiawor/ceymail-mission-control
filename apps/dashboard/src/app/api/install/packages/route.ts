import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Whitelist of allowed packages
const ALLOWED_PACKAGES = new Set([
  "apache2",
  "certbot",
  "python3-certbot-apache",
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
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { package: pkgName, phpVersion } = body as {
      package?: string;
      phpVersion?: string;
    };

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

    // Install the package using apt-get
    const env = { ...process.env, DEBIAN_FRONTEND: "noninteractive" };

    try {
      const { stdout, stderr } = await execFileAsync(
        "apt-get",
        ["install", "-y", "--no-install-recommends", pkgName],
        { encoding: "utf8", timeout: 300000, env } // 5 min timeout per package
      );

      return NextResponse.json({
        name: pkgName,
        status: "installed",
        output: (stdout + stderr).slice(-500), // Last 500 chars of output
      });
    } catch (installError: any) {
      console.error(`Failed to install ${pkgName}:`, installError);
      return NextResponse.json({
        name: pkgName,
        status: "failed",
        output: installError.stderr?.slice(-500) || installError.message,
      }, { status: 500 });
    }
  } catch (error) {
    console.error("Error in package install:", error);
    return NextResponse.json(
      { error: "Failed to install package" },
      { status: 500 }
    );
  }
}

// GET - Get list of PHP packages for a given version
export async function GET(request: NextRequest) {
  const phpVersion = request.nextUrl.searchParams.get("phpVersion") || "8.2";

  // Validate version format
  if (!/^\d+\.\d+$/.test(phpVersion)) {
    return NextResponse.json({ error: "Invalid PHP version format" }, { status: 400 });
  }

  const phpPackages = PHP_PACKAGES.map((p) => p.replace(/\{VER\}/g, phpVersion));

  return NextResponse.json({
    packages: phpPackages,
  });
}
