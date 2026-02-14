import { NextRequest, NextResponse } from "next/server";
import { execFileSync, spawnSync } from "child_process";
import { existsSync, statSync, readdirSync, unlinkSync, accessSync, constants } from "fs";
import { join, resolve } from "path";
import { requireAdmin } from "@/lib/api/helpers";
import { getConfig } from "@/lib/config/config";

const BACKUP_DIR = "/var/backups/ceymail";

// Module-level lock prevents concurrent backup creation. Since backup uses
// synchronous child process calls that block the event loop, a second
// concurrent request would queue behind the first anyway — but this lock
// provides an immediate 409 response instead of silently waiting.
let backupInProgress = false;

interface BackupInfo {
  id: string;
  date: string;
  time: string;
  size: number;
  contents: {
    config: boolean;
    database: boolean;
    dkim: boolean;
    mailboxes: boolean;
  };
  status: "complete" | "in-progress" | "failed";
}

function parseBackupFilename(filename: string): Partial<BackupInfo> | null {
  // Expected format: ceymail-backup-YYYYMMDD-HHMMSS[-contents].tar.gz
  const match = filename.match(
    /^ceymail-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(.+))?\.tar\.gz$/
  );
  if (!match) return null;

  const [, year, month, day, hour, min, sec, contentsStr] = match;
  const contents = {
    config: true,
    database: true,
    dkim: true,
    mailboxes: true,
  };

  if (contentsStr) {
    contents.config = contentsStr.includes("config");
    contents.database = contentsStr.includes("db");
    contents.dkim = contentsStr.includes("dkim");
    contents.mailboxes = contentsStr.includes("mail");
  }

  return {
    id: filename.replace(".tar.gz", ""),
    date: `${year}-${month}-${day}`,
    time: `${hour}:${min}:${sec}`,
    contents,
    status: "complete",
  };
}

// GET - List all backups
export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    // Ensure backup directory exists
    if (!existsSync(BACKUP_DIR)) {
      return NextResponse.json([]);
    }

    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".tar.gz"))
      .sort()
      .reverse();

    const backups: BackupInfo[] = [];

    for (const file of files) {
      const parsed = parseBackupFilename(file);
      if (!parsed) continue;

      const filepath = join(BACKUP_DIR, file);
      let size = 0;
      try {
        const stat = statSync(filepath);
        size = stat.size;
      } catch {
        // Can't stat file
      }

      backups.push({
        id: parsed.id || file,
        date: parsed.date || "",
        time: parsed.time || "",
        size,
        contents: parsed.contents || { config: true, database: true, dkim: true, mailboxes: true },
        status: size > 0 ? "complete" : "failed",
      });
    }

    return NextResponse.json(backups);
  } catch (error) {
    console.error("Error listing backups:", error);
    return NextResponse.json(
      { error: "Failed to list backups" },
      { status: 500 }
    );
  }
}

// POST - Create a new backup
export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  if (backupInProgress) {
    return NextResponse.json(
      { error: "A backup is already in progress" },
      { status: 409 }
    );
  }

  backupInProgress = true;
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const {
      config = true,
      database = true,
      dkim = true,
      mailboxes = true,
    } = body as {
      config?: boolean;
      database?: boolean;
      dkim?: boolean;
      mailboxes?: boolean;
    };

    if (!config && !database && !dkim && !mailboxes) {
      return NextResponse.json(
        { error: "At least one backup component must be selected" },
        { status: 400 }
      );
    }

    // Ensure backup directory exists (owned by ceymail-mc for listing/deletion)
    if (!existsSync(BACKUP_DIR)) {
      const mkdirResult = spawnSync("/usr/bin/sudo", ["/usr/bin/mkdir", "-p", BACKUP_DIR], {
        encoding: "utf8",
        timeout: 5000,
      });
      if (mkdirResult.status !== 0) {
        return NextResponse.json(
          { error: "Failed to create backup directory" },
          { status: 500 }
        );
      }
      const chownResult = spawnSync("/usr/bin/sudo", ["/usr/bin/chown", "ceymail-mc:ceymail-mc", BACKUP_DIR], {
        encoding: "utf8",
        timeout: 5000,
      });
      if (chownResult.status !== 0) {
        return NextResponse.json(
          { error: "Failed to set backup directory permissions" },
          { status: 500 }
        );
      }
    }

    // Verify the process can write to the backup directory. The directory
    // may exist but be owned by root from a previous failed setup.
    try {
      accessSync(BACKUP_DIR, constants.W_OK);
    } catch {
      return NextResponse.json(
        { error: "Backup directory is not writable. Check ownership of " + BACKUP_DIR },
        { status: 500 }
      );
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const contentsTag = [
      config ? "config" : "",
      database ? "db" : "",
      dkim ? "dkim" : "",
      mailboxes ? "mail" : "",
    ].filter(Boolean).join("-");

    const filename = `ceymail-backup-${timestamp.slice(0, 8)}-${timestamp.slice(8)}-${contentsTag}.tar.gz`;
    const filepath = join(BACKUP_DIR, filename);

    // Build list of paths to include
    const paths: string[] = [];
    if (config) {
      paths.push("/etc/postfix", "/etc/dovecot", "/etc/spamassassin", "/etc/apache2/sites-available");
    }
    if (dkim) {
      paths.push("/etc/opendkim");
    }
    if (mailboxes) {
      paths.push("/var/mail/vhosts");
    }

    // Filter to only existing paths. If nothing exists and no DB dump
    // is requested, we'd have nothing to archive — catch this early.
    const existingPaths = paths.filter((p) => existsSync(p));

    if (existingPaths.length === 0 && !database) {
      return NextResponse.json(
        { error: "None of the selected backup components exist on this server yet" },
        { status: 400 }
      );
    }

    // Database dump
    let dbDumpPath = "";
    if (database) {
      dbDumpPath = join(BACKUP_DIR, `.tmp-dbdump-${timestamp}.sql`);
      try {
        // Read credentials from config system (not process.env)
        const appConfig = getConfig();
        const dbPassword = appConfig?.database.password || process.env.DB_PASSWORD;
        const dbUser = appConfig?.database.user || process.env.DB_USER || "ceymail";
        const dbHost = appConfig?.database.host || process.env.DB_HOST || "localhost";

        if (!dbPassword) {
          throw new Error("Database password not configured");
        }

        // Pass only MYSQL_PWD to the child process — spreading all of
        // process.env would leak SESSION_SECRET and other secrets.
        // PATH is needed so mysqldump can find shared libraries.
        execFileSync("/usr/bin/mysqldump", [
          `-u${dbUser}`,
          `-h${dbHost}`,
          "--databases", "ceymail", "ceymail_dashboard",
          "--result-file", dbDumpPath,
        ], {
          encoding: "utf8",
          timeout: 120000,
          env: {
            MYSQL_PWD: dbPassword,
            PATH: process.env.PATH || "/usr/bin:/bin",
            HOME: process.env.HOME || "/tmp",
            NODE_ENV: process.env.NODE_ENV || "production",
          } as NodeJS.ProcessEnv,
        });
        existingPaths.push(dbDumpPath);
      } catch (dumpError: unknown) {
        // Sanitize: only log stderr and exit code — the full error object
        // may contain MYSQL_PWD in its cmd/envPairs properties.
        const cpErr = dumpError as { stderr?: string; status?: number; message?: string };
        console.error("Database dump failed:", cpErr.stderr || cpErr.message || "unknown error", "exit code:", cpErr.status);
        // Clean up failed dump file
        if (dbDumpPath && existsSync(dbDumpPath)) {
          try { unlinkSync(dbDumpPath); } catch { /* ignore */ }
        }
        return NextResponse.json(
          { error: "Database backup failed — cannot create backup with incomplete data" },
          { status: 500 }
        );
      }
    }

    // Create tar archive via the restricted wrapper script (validates paths).
    // The finally block ensures the temp DB dump is always cleaned up, even
    // if the process crashes or throws between tar creation and cleanup.
    try {
      const tarResult = spawnSync("/usr/bin/sudo", [
        "/usr/local/bin/ceymail-backup", filepath,
        ...existingPaths,
      ], {
        encoding: "utf8",
        timeout: 300000, // 5 min timeout for large backups
      });
      if (tarResult.status !== 0) {
        throw new Error((tarResult.stderr || "").trim() || "backup archive creation failed");
      }
    } catch (tarError) {
      console.error("Tar creation failed:", tarError);
      return NextResponse.json(
        { error: "Failed to create backup archive" },
        { status: 500 }
      );
    } finally {
      // Always clean up the temp DB dump — even on tar failure or unexpected throw
      if (dbDumpPath && existsSync(dbDumpPath)) {
        try { unlinkSync(dbDumpPath); } catch { /* ignore */ }
      }
    }

    // Get the size of the created backup
    let size = 0;
    try {
      const stat = statSync(filepath);
      size = stat.size;
    } catch { /* ignore */ }

    const backupId = filename.replace(".tar.gz", "");
    // Use UTC methods to match the filename timestamp (derived from toISOString).
    // Without this, the POST response would show local time while the GET response
    // (parsed from the filename) shows UTC, causing a confusing mismatch.
    return NextResponse.json({
      id: backupId,
      date: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`,
      time: `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}:${String(now.getUTCSeconds()).padStart(2, "0")}`,
      size,
      contents: { config, database, dkim, mailboxes },
      status: "complete",
    }, { status: 201 });
  } catch (error) {
    console.error("Error creating backup:", error);
    return NextResponse.json(
      { error: "Failed to create backup" },
      { status: 500 }
    );
  } finally {
    backupInProgress = false;
  }
}

// DELETE - Delete a backup
export async function DELETE(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const id = request.nextUrl.searchParams.get("id");

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Backup ID is required" }, { status: 400 });
    }

    // Sanitize: only allow alphanumeric, dash, underscore
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid backup ID format" }, { status: 400 });
    }

    const filepath = resolve(join(BACKUP_DIR, `${id}.tar.gz`));
    if (!filepath.startsWith(BACKUP_DIR + "/")) {
      return NextResponse.json({ error: "Invalid backup ID" }, { status: 400 });
    }

    // Verify the file matches the expected backup filename format before
    // deletion — defense-in-depth against deleting non-backup files that
    // happen to exist in the backup directory with a valid-looking name.
    const parsed = parseBackupFilename(`${id}.tar.gz`);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid backup ID format" }, { status: 400 });
    }

    if (!existsSync(filepath)) {
      return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    }

    unlinkSync(filepath);

    return NextResponse.json({ message: "Backup deleted successfully" });
  } catch (error) {
    console.error("Error deleting backup:", error);
    return NextResponse.json(
      { error: "Failed to delete backup" },
      { status: 500 }
    );
  }
}
