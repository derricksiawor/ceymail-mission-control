import { NextRequest, NextResponse } from "next/server";
import { openSync, fstatSync, readSync, closeSync, existsSync } from "fs";
import { requireAdmin } from "@/lib/api/helpers";

const MAIL_LOG_PATH = "/var/log/mail.log";
const MAX_LINES = 200;
// Read at most 128KB from the tail of the log file to avoid OOM on large logs.
// 128KB covers ~1000+ syslog lines which is more than MAX_LINES needs.
const TAIL_BYTES = 128 * 1024;

interface MailLogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error" | "debug";
  source: string;
  message: string;
}

function deriveLevel(message: string): MailLogEntry["level"] {
  const lower = message.toLowerCase();
  if (lower.includes("error") || lower.includes("fatal") || lower.includes("panic") || lower.includes("reject")) return "error";
  if (lower.includes("warning") || lower.includes("warn") || lower.includes("timeout") || lower.includes("deferred")) return "warning";
  if (lower.includes("debug")) return "debug";
  return "info";
}

function parseService(raw: string): string {
  // Strip PID: "postfix/smtp[12345]" -> "postfix/smtp"
  return raw.replace(/\[\d+\]$/, "").trim();
}

/**
 * Parse a syslog-format mail log line.
 * Formats:
 *   2026-02-14T01:22:40.881583+00:00 mail postfix/smtp[742507]: message here
 *   Feb 14 01:22:40 mail postfix/smtp[742507]: message here
 */
function parseLine(line: string, index: number): MailLogEntry | null {
  if (!line.trim()) return null;

  // ISO 8601 format (rsyslog default on Ubuntu 22.04+)
  let match = line.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?[+-]\d{2}:\d{2}\s+\S+\s+(\S+):\s+(.+)$/
  );
  if (match) {
    const [, ts, service, message] = match;
    const timestamp = ts.replace("T", " ");
    return {
      id: `mail-${index}`,
      timestamp,
      level: deriveLevel(message),
      source: parseService(service),
      message,
    };
  }

  // Traditional BSD syslog format
  match = line.match(
    /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+(\S+):\s+(.+)$/
  );
  if (match) {
    const [, timestamp, service, message] = match;
    return {
      id: `mail-${index}`,
      timestamp,
      level: deriveLevel(message),
      source: parseService(service),
      message,
    };
  }

  return null;
}

/**
 * Read the tail of a file without loading the entire thing into memory.
 * Returns the content string from the last `maxBytes` of the file,
 * skipping the first partial line if we started mid-file.
 */
function readTail(filepath: string, maxBytes: number): string {
  const fd = openSync(filepath, "r");
  try {
    const stat = fstatSync(fd);
    const fileSize = stat.size;
    if (fileSize === 0) return "";

    const readFromBeginning = fileSize <= maxBytes;
    const start = readFromBeginning ? 0 : fileSize - maxBytes;
    const bufSize = fileSize - start;

    const buf = Buffer.alloc(bufSize);
    readSync(fd, buf, 0, bufSize, start);
    let content = buf.toString("utf8");

    // If we started mid-file, the first line is partial — skip it
    if (!readFromBeginning) {
      const firstNewline = content.indexOf("\n");
      if (firstNewline >= 0) {
        content = content.slice(firstNewline + 1);
      }
    }

    return content;
  } finally {
    closeSync(fd);
  }
}

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get("limit") || "100", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_LINES)
      : 100;

    if (!existsSync(MAIL_LOG_PATH)) {
      // Normal during initial setup — log file hasn't been created yet
      return NextResponse.json([]);
    }

    let content: string;
    try {
      content = readTail(MAIL_LOG_PATH, TAIL_BYTES);
    } catch (readError: unknown) {
      // Distinguish permission errors from other failures so the frontend
      // can show a meaningful diagnostic instead of a generic 500.
      const code = (readError as NodeJS.ErrnoException)?.code;
      if (code === "EACCES" || code === "EPERM") {
        return NextResponse.json(
          { error: "Cannot read mail log. Ensure the dashboard user is in the adm group." },
          { status: 403 }
        );
      }
      // ENOENT: file was rotated between existsSync and openSync — return
      // empty array (same as file-not-found). Next poll will pick up the new file.
      if (code === "ENOENT") {
        return NextResponse.json([]);
      }
      // Other unexpected error (disk I/O failure, etc.)
      console.error("Unexpected error reading mail log:", readError);
      return NextResponse.json(
        { error: "Failed to read mail log" },
        { status: 500 }
      );
    }

    const lines = content.trim().split("\n");
    const recent = lines.slice(-limit);
    const entries: MailLogEntry[] = [];

    for (let i = 0; i < recent.length; i++) {
      const entry = parseLine(recent[i], i);
      if (entry) entries.push(entry);
    }

    return NextResponse.json(entries);
  } catch (error) {
    console.error("Error reading mail log:", error);
    return NextResponse.json(
      { error: "Failed to read mail log" },
      { status: 500 }
    );
  }
}
