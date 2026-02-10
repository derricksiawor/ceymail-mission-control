import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { requireAdmin } from "@/lib/api/helpers";

interface PermissionResult {
  label: string;
  done: boolean;
  error?: string;
}

// Map short command names to full paths for sudo
const CMD_PATHS: Record<string, string> = {
  mkdir: "/usr/bin/mkdir",
  chown: "/usr/bin/chown",
  chmod: "/usr/bin/chmod",
  touch: "/usr/bin/touch",
  useradd: "/usr/sbin/useradd",
  groupadd: "/usr/sbin/groupadd",
  id: "/usr/bin/id",
};

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
    label: "/etc/opendkim/keys - ownership opendkim:opendkim, mode 0750",
    commands: [
      { cmd: "mkdir", args: ["-p", "/etc/opendkim/keys"] },
      { cmd: "chown", args: ["-R", "opendkim:opendkim", "/etc/opendkim/keys"] },
      { cmd: "chmod", args: ["750", "/etc/opendkim/keys"] },
    ],
    check: "/etc/opendkim/keys",
  },
  {
    label: "/var/spool/postfix/opendkim - socket dir for Postfix chroot",
    commands: [
      { cmd: "mkdir", args: ["-p", "/var/spool/postfix/opendkim"] },
      { cmd: "chown", args: ["opendkim:postfix", "/var/spool/postfix/opendkim"] },
      { cmd: "chmod", args: ["750", "/var/spool/postfix/opendkim"] },
    ],
    check: "/var/spool/postfix",
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

function sudoExec(cmd: string, args: string[]): { status: number | null; stderr: string } {
  const fullPath = CMD_PATHS[cmd] || cmd;
  const result = spawnSync("/usr/bin/sudo", [fullPath, ...args], {
    encoding: "utf8",
    timeout: 10000,
  });
  return { status: result.status, stderr: (result.stderr || "").trim() };
}

// POST - Fix all file permissions
export async function POST(request: NextRequest) {
  try {
    const denied = requireAdmin(request);
    if (denied) return denied;

    const results: PermissionResult[] = [];

    // Create vmail group and user if they don't exist
    const idCheck = sudoExec("id", ["vmail"]);
    if (idCheck.status !== 0) {
      // Always create vmail group first (chown vmail:vmail requires it)
      sudoExec("groupadd", ["-g", "5000", "vmail"]);
      sudoExec("useradd", [
        "-r", "-u", "5000", "-g", "vmail",
        "-d", "/var/mail/vhosts",
        "-s", "/usr/sbin/nologin",
        "vmail",
      ]);
    } else {
      // User exists — ensure vmail group also exists (may have been created with -g mail)
      const grpCheck = spawnSync("/usr/bin/getent", ["group", "vmail"], { encoding: "utf8", timeout: 5000 });
      if (grpCheck.status !== 0) {
        sudoExec("groupadd", ["-g", "5000", "vmail"]);
      }
    }

    for (const item of PERMISSION_MANIFEST) {
      try {
        // Skip if the base path doesn't exist (package not installed) — unless commands create it
        if (item.check && !existsSync(item.check) && !item.commands.some(c => c.cmd === "mkdir" || c.cmd === "touch")) {
          results.push({ label: item.label, done: false, error: "Path does not exist (package may not be installed)" });
          continue;
        }

        for (const cmd of item.commands) {
          const result = sudoExec(cmd.cmd, cmd.args);
          if (result.status !== 0) {
            // Allow chmod failures on non-existent files
            if (cmd.cmd !== "chmod" || !result.stderr.includes("No such file")) {
              throw new Error(`${cmd.cmd} ${cmd.args.join(" ")} failed: ${result.stderr}`);
            }
          }
        }
        results.push({ label: item.label, done: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ label: item.label, done: false, error: message });
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
