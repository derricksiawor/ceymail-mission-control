import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { requireAdmin } from "@/lib/api/helpers";
import { getDashboardPool } from "@/lib/db/connection";
import { RowDataPacket } from "mysql2/promise";

interface SettingsResponse {
  general: {
    hostname: string;
    adminEmail: string;
    timezone: string;
    maxMessageSize: string;
    smtpBanner: string;
  };
  security: {
    minPasswordLength: number;
    requireUppercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    sessionTimeout: number;
    maxLoginAttempts: number;
    lockoutDuration: number;
    enforceSSL: boolean;
  };
  notifications: {
    enableEmailAlerts: boolean;
    alertRecipient: string;
    notifyOnServiceDown: boolean;
    notifyOnDiskWarning: boolean;
    notifyOnLoginFailure: boolean;
    notifyOnQueueBacklog: boolean;
    diskWarningThreshold: number;
    queueBacklogThreshold: number;
  };
  about: {
    os: string;
    kernel: string;
    architecture: string;
    hostname: string;
    timezone: string;
    components: { name: string; version: string }[];
  };
}

function readPostfixSetting(key: string): string {
  try {
    const output = execFileSync("postconf", [key], { encoding: "utf8", timeout: 5000 }).trim();
    // postconf output: "key = value"
    const eqIdx = output.indexOf("=");
    return eqIdx >= 0 ? output.slice(eqIdx + 1).trim() : "";
  } catch {
    return "";
  }
}

function getTimezone(): string {
  try {
    return execFileSync("timedatectl", ["show", "-p", "Timezone", "--value"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    try {
      return readFileSync("/etc/timezone", "utf8").trim();
    } catch {
      return "UTC";
    }
  }
}

function getOsInfo(): { os: string; kernel: string; arch: string } {
  let os = "Unknown";
  let kernel = "Unknown";
  let arch = "Unknown";

  try {
    kernel = execFileSync("uname", ["-r"], { encoding: "utf8", timeout: 5000 }).trim();
    arch = execFileSync("uname", ["-m"], { encoding: "utf8", timeout: 5000 }).trim();
  } catch { /* ignore */ }

  try {
    if (existsSync("/etc/os-release")) {
      const content = readFileSync("/etc/os-release", "utf8");
      const nameMatch = content.match(/PRETTY_NAME="?([^"\n]+)"?/);
      if (nameMatch) os = nameMatch[1];
    }
  } catch { /* ignore */ }

  return { os, kernel, arch };
}

function getComponentVersion(name: string): string {
  const versionCommands: Record<string, string[]> = {
    Postfix: ["postconf", "mail_version"],
    Dovecot: ["dovecot", "--version"],
    OpenDKIM: ["opendkim", "-V"],
    SpamAssassin: ["spamassassin", "--version"],
    MariaDB: ["mariadb", "--version"],
    Apache: ["apache2", "-v"],
    Unbound: ["unbound", "-V"],
    Rsyslog: ["rsyslogd", "-v"],
  };

  const cmd = versionCommands[name];
  if (!cmd) return "N/A";

  try {
    let output: string;
    try {
      output = execFileSync(cmd[0], cmd.slice(1), { encoding: "utf8", timeout: 5000 });
    } catch (execError) {
      // Some tools (e.g. opendkim -V) output version to stderr
      const err = execError as { stderr?: string; stdout?: string };
      if (err.stderr && err.stderr.trim()) {
        output = err.stderr;
      } else if (err.stdout && err.stdout.trim()) {
        output = err.stdout;
      } else {
        throw execError;
      }
    }

    // Parse version from output based on component
    if (name === "Postfix") {
      const eqIdx = output.indexOf("=");
      return eqIdx >= 0 ? output.slice(eqIdx + 1).trim() : output.trim();
    }
    if (name === "Dovecot") {
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : output.trim().split("\n")[0];
    }
    if (name === "MariaDB") {
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : "Unknown";
    }
    if (name === "Apache") {
      const match = output.match(/Apache\/(\S+)/);
      return match ? match[1] : "Unknown";
    }
    if (name === "SpamAssassin") {
      const match = output.match(/version\s+(\S+)/i);
      return match ? match[1] : "Unknown";
    }
    if (name === "Unbound") {
      const match = output.match(/Version\s+(\S+)/i);
      return match ? match[1] : "Unknown";
    }
    if (name === "Rsyslog") {
      const match = output.match(/rsyslogd\s+(\S+)/);
      return match ? match[1].replace(",", "") : "Unknown";
    }
    if (name === "OpenDKIM") {
      const match = output.match(/(\d+\.\d+\.\d+)/);
      return match ? match[1] : "Unknown";
    }

    return output.trim().split("\n")[0];
  } catch {
    return "Not installed";
  }
}

// GET - Read current settings from real config files
export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const hostname = readPostfixSetting("myhostname") || "localhost";
    const maxMsgSize = readPostfixSetting("message_size_limit");
    const maxMsgSizeMB = maxMsgSize ? String(Math.round(parseInt(maxMsgSize, 10) / 1048576)) : "25";
    const smtpBanner = readPostfixSetting("smtpd_banner") || "$myhostname ESMTP";
    const tlsLevel = readPostfixSetting("smtpd_tls_security_level");

    // Get admin email from the dashboard database (set during setup wizard)
    let adminEmail = "";
    try {
      const pool = getDashboardPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT email FROM dashboard_users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
      );
      if (rows.length > 0 && rows[0].email) {
        adminEmail = rows[0].email;
      }
    } catch { /* ignore - DB may not be ready */ }
    if (!adminEmail) {
      adminEmail = `postmaster@${hostname.replace(/^mail\./, "")}`;
    }

    const tz = getTimezone();
    const osInfo = getOsInfo();

    const components = [
      "Postfix", "Dovecot", "OpenDKIM", "SpamAssassin",
      "MariaDB", "Apache", "Unbound", "Rsyslog",
    ].map((name) => ({
      name,
      version: getComponentVersion(name),
    }));

    const settings: SettingsResponse = {
      general: {
        hostname,
        adminEmail,
        timezone: tz,
        maxMessageSize: maxMsgSizeMB,
        smtpBanner,
      },
      security: {
        minPasswordLength: 8,
        requireUppercase: true,
        requireNumbers: true,
        requireSpecialChars: true,
        sessionTimeout: 480,
        maxLoginAttempts: 0,
        lockoutDuration: 0,
        enforceSSL: tlsLevel === "encrypt" || tlsLevel === "may",
      },
      notifications: {
        enableEmailAlerts: false,
        alertRecipient: adminEmail,
        notifyOnServiceDown: true,
        notifyOnDiskWarning: true,
        notifyOnLoginFailure: true,
        notifyOnQueueBacklog: false,
        diskWarningThreshold: 85,
        queueBacklogThreshold: 100,
      },
      about: {
        os: osInfo.os,
        kernel: osInfo.kernel,
        architecture: osInfo.arch,
        hostname,
        timezone: tz,
        components,
      },
    };

    return NextResponse.json(settings);
  } catch (error) {
    console.error("Error reading settings:", error);
    return NextResponse.json(
      { error: "Failed to read settings" },
      { status: 500 }
    );
  }
}

// PATCH - Update settings (writes to real config files)
export async function PATCH(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { section, key, value } = body as { section?: string; key?: string; value?: unknown };

    if (!section || !key) {
      return NextResponse.json({ error: "Section and key are required" }, { status: 400 });
    }

    // Only allow writing certain Postfix settings
    const allowedPostfixSettings: Record<string, string> = {
      hostname: "myhostname",
      maxMessageSize: "message_size_limit",
      smtpBanner: "smtpd_banner",
    };

    if (section === "general" && allowedPostfixSettings[key]) {
      if (typeof value !== "string" && typeof value !== "number") {
        return NextResponse.json({ error: "Value must be a string or number" }, { status: 400 });
      }
      const postfixKey = allowedPostfixSettings[key];
      let postfixValue = String(value).trim();
      if (postfixValue.length === 0) {
        return NextResponse.json({ error: "Value must not be empty" }, { status: 400 });
      }

      // Convert MB to bytes for message_size_limit
      if (key === "maxMessageSize") {
        const mb = parseInt(postfixValue, 10);
        if (isNaN(mb) || mb < 1 || mb > 100) {
          return NextResponse.json({ error: "Max message size must be between 1 and 100 MB" }, { status: 400 });
        }
        postfixValue = String(mb * 1048576);
      }

      // Validate no shell metacharacters or control characters
      if (/[;&|`$(){}[\]<>!#]/.test(postfixValue)) {
        return NextResponse.json({ error: "Value contains invalid characters" }, { status: 400 });
      }
      if (/[\n\r\0]/.test(postfixValue)) {
        return NextResponse.json({ error: "Value contains invalid characters" }, { status: 400 });
      }

      try {
        execFileSync("postconf", ["-e", `${postfixKey}=${postfixValue}`], {
          encoding: "utf8",
          timeout: 10000,
        });

        // Validate config
        execFileSync("postconf", ["-n"], { encoding: "utf8", timeout: 5000 });

        return NextResponse.json({ message: "Setting updated successfully" });
      } catch (postconfError) {
        console.error("Error updating postfix setting:", postconfError);
        return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Setting not supported for modification" }, { status: 400 });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
