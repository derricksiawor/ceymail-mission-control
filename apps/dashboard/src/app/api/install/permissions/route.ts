import { NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { existsSync } from "fs";

interface PermissionResult {
  label: string;
  done: boolean;
  error?: string;
}

// Permission manifest - what needs to be set
const PERMISSION_MANIFEST = [
  {
    label: "/var/mail/vhosts - ownership vmail:vmail",
    commands: [
      { cmd: "mkdir", args: ["-p", "/var/mail/vhosts"] },
      { cmd: "chown", args: ["-R", "vmail:vmail", "/var/mail/vhosts"] },
      { cmd: "chmod", args: ["755", "/var/mail/vhosts"] },
    ],
    check: "/var/mail/vhosts",
  },
  {
    label: "/etc/postfix - ownership root:postfix, mode 0755",
    commands: [
      { cmd: "chown", args: ["-R", "root:postfix", "/etc/postfix"] },
      { cmd: "chmod", args: ["755", "/etc/postfix"] },
      { cmd: "chmod", args: ["640", "/etc/postfix/mysql-virtual-mailbox-domains.cf"] },
      { cmd: "chmod", args: ["640", "/etc/postfix/mysql-virtual-mailbox-maps.cf"] },
      { cmd: "chmod", args: ["640", "/etc/postfix/mysql-virtual-alias-maps.cf"] },
    ],
    check: "/etc/postfix",
  },
  {
    label: "/etc/dovecot - ownership root:dovecot, mode 0755",
    commands: [
      { cmd: "chown", args: ["-R", "root:dovecot", "/etc/dovecot"] },
      { cmd: "chmod", args: ["755", "/etc/dovecot"] },
      { cmd: "chmod", args: ["600", "/etc/dovecot/dovecot-sql.conf.ext"] },
    ],
    check: "/etc/dovecot",
  },
  {
    label: "/etc/opendkim/keys - ownership opendkim:opendkim, mode 0700",
    commands: [
      { cmd: "mkdir", args: ["-p", "/etc/opendkim/keys"] },
      { cmd: "chown", args: ["-R", "opendkim:opendkim", "/etc/opendkim/keys"] },
      { cmd: "chmod", args: ["700", "/etc/opendkim/keys"] },
    ],
    check: "/etc/opendkim/keys",
  },
  {
    label: "/etc/spamassassin - ownership root:root, mode 0644",
    commands: [
      { cmd: "chown", args: ["-R", "root:root", "/etc/spamassassin"] },
      { cmd: "chmod", args: ["644", "/etc/spamassassin/local.cf"] },
    ],
    check: "/etc/spamassassin",
  },
  {
    label: "/var/log/mail.log - ownership syslog:adm, mode 0640",
    commands: [
      { cmd: "touch", args: ["/var/log/mail.log"] },
      { cmd: "chown", args: ["syslog:adm", "/var/log/mail.log"] },
      { cmd: "chmod", args: ["640", "/var/log/mail.log"] },
    ],
    check: "/var/log/mail.log",
  },
];

// POST - Fix all file permissions
export async function POST() {
  try {
    const results: PermissionResult[] = [];

    // Create vmail user if it doesn't exist
    try {
      execFileSync("id", ["vmail"], { encoding: "utf8", timeout: 5000 });
    } catch {
      try {
        execFileSync("useradd", [
          "-r", "-u", "5000", "-g", "mail",
          "-d", "/var/mail/vhosts",
          "-s", "/usr/sbin/nologin",
          "vmail",
        ], { encoding: "utf8", timeout: 5000 });
      } catch {
        // User may already exist with different uid or groupadd needed
        try {
          execFileSync("groupadd", ["-g", "5000", "vmail"], { encoding: "utf8", timeout: 5000 });
          execFileSync("useradd", [
            "-r", "-u", "5000", "-g", "vmail",
            "-d", "/var/mail/vhosts",
            "-s", "/usr/sbin/nologin",
            "vmail",
          ], { encoding: "utf8", timeout: 5000 });
        } catch {
          // Best effort
        }
      }
    }

    for (const item of PERMISSION_MANIFEST) {
      try {
        // Skip if the base path doesn't exist (package not installed)
        if (item.check && !existsSync(item.check) && !item.commands.some(c => c.cmd === "mkdir")) {
          results.push({ label: item.label, done: false, error: "Path does not exist (package may not be installed)" });
          continue;
        }

        for (const cmd of item.commands) {
          try {
            execFileSync(cmd.cmd, cmd.args, { encoding: "utf8", timeout: 10000 });
          } catch (cmdErr: any) {
            // Continue with next command, some may fail (e.g., file doesn't exist yet)
            if (cmd.cmd !== "chmod" || !cmdErr.message.includes("No such file")) {
              throw cmdErr;
            }
          }
        }
        results.push({ label: item.label, done: true });
      } catch (err: any) {
        results.push({ label: item.label, done: false, error: err.message });
      }
    }

    return NextResponse.json({
      results,
      allDone: results.every((r) => r.done),
    });
  } catch (error) {
    console.error("Error fixing permissions:", error);
    return NextResponse.json(
      { error: "Failed to fix permissions" },
      { status: 500 }
    );
  }
}
