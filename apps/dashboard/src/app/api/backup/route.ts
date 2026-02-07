import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { existsSync, statSync, readdirSync, unlinkSync } from "fs";
import { join, basename } from "path";

const BACKUP_DIR = "/var/backups/ceymail";

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
export async function GET() {
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

    // Ensure backup directory exists
    if (!existsSync(BACKUP_DIR)) {
      execFileSync("mkdir", ["-p", BACKUP_DIR], { timeout: 5000 });
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

    // Filter to only existing paths
    const existingPaths = paths.filter((p) => existsSync(p));

    // Database dump
    let dbDumpPath = "";
    if (database) {
      dbDumpPath = join(BACKUP_DIR, `.tmp-dbdump-${timestamp}.sql`);
      try {
        const dbPassword = process.env.DB_PASSWORD;
        const dbUser = process.env.DB_USER || "ceymail";
        const dbHost = process.env.DB_HOST || "localhost";

        execFileSync("mysqldump", [
          `-u${dbUser}`,
          `-p${dbPassword}`,
          `-h${dbHost}`,
          "--databases", "ceymail",
          "--result-file", dbDumpPath,
        ], {
          encoding: "utf8",
          timeout: 120000,
        });
        existingPaths.push(dbDumpPath);
      } catch (dumpError) {
        console.error("Database dump failed:", dumpError);
        // Continue without DB dump
      }
    }

    // Create tar archive
    try {
      execFileSync("tar", [
        "czf", filepath,
        ...existingPaths,
      ], {
        encoding: "utf8",
        timeout: 300000, // 5 min timeout for large backups
      });
    } catch (tarError) {
      console.error("Tar creation failed:", tarError);
      return NextResponse.json(
        { error: "Failed to create backup archive" },
        { status: 500 }
      );
    }

    // Cleanup temp DB dump
    if (dbDumpPath && existsSync(dbDumpPath)) {
      try { unlinkSync(dbDumpPath); } catch { /* ignore */ }
    }

    // Get the size of the created backup
    let size = 0;
    try {
      const stat = statSync(filepath);
      size = stat.size;
    } catch { /* ignore */ }

    const backupId = filename.replace(".tar.gz", "");
    return NextResponse.json({
      id: backupId,
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
      time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`,
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
  }
}

// DELETE - Delete a backup
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Backup ID is required" }, { status: 400 });
    }

    // Sanitize: only allow alphanumeric, dash, underscore
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid backup ID format" }, { status: 400 });
    }

    const filepath = join(BACKUP_DIR, `${id}.tar.gz`);

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
