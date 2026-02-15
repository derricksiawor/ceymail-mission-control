import { NextRequest, NextResponse } from "next/server";
import { execFileSync, spawnSync } from "child_process";
import { readFileSync } from "fs";
import { getDashboardPool } from "@/lib/db/connection";
import { requireAdmin } from "@/lib/api/helpers";
import type { RowDataPacket } from "mysql2/promise";

interface HealthSnapshot extends RowDataPacket {
  id: number;
  timestamp: string;
  cpu_percent: number;
  memory_used_bytes: number;
  disk_used_bytes: number;
  mail_queue_size: number;
  services_healthy: number;
  services_total: number;
}

const MONITORED_SERVICES = ["postfix", "dovecot", "opendkim", "spamassassin", "unbound", "rsyslog", "mariadb"];

// Minimum interval between auto-collections (60 seconds)
const COLLECT_INTERVAL_MS = 60_000;

// Maximum time to wait for a collection before returning stale data (15 seconds).
// Prevents the endpoint from hanging indefinitely on slow disk I/O or DB issues.
const COLLECT_TIMEOUT_MS = 15_000;

// Promise-based lock: only one collection can run at a time.
// Unlike a boolean flag, concurrent callers await the same promise
// instead of both entering the critical section.
let collectingPromise: Promise<void> | null = null;

// Cached system totals (memory_total, disk_total) — these values rarely
// change and do not need to be recalculated on every request. Refreshed
// once per collection cycle (~1 min) instead of every poll (~10s).
let cachedTotals: { memory_total_bytes: number; disk_total_bytes: number } = {
  memory_total_bytes: 0,
  disk_total_bytes: 0,
};

function refreshSystemTotals(): void {
  // Memory total
  try {
    const memOutput = execFileSync("free", ["-b"], { encoding: "utf8", timeout: 5000 });
    const memMatch = memOutput.match(/Mem:\s+(\d+)/);
    if (memMatch) cachedTotals.memory_total_bytes = parseInt(memMatch[1], 10);
  } catch {
    try {
      const sysctl = execFileSync("sysctl", ["-n", "hw.memsize"], { encoding: "utf8", timeout: 5000 }).trim();
      cachedTotals.memory_total_bytes = parseInt(sysctl, 10);
    } catch { /* leave previous value */ }
  }

  // Disk total
  try {
    const dfOutput = execFileSync("df", ["-B1", "/"], { encoding: "utf8", timeout: 5000 });
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      const cols = lines[1].split(/\s+/);
      if (cols.length >= 2) cachedTotals.disk_total_bytes = parseInt(cols[1], 10);
    }
  } catch {
    try {
      const dfOutput = execFileSync("df", ["-k", "/"], { encoding: "utf8", timeout: 5000 });
      const lines = dfOutput.trim().split("\n");
      if (lines.length >= 2) {
        const cols = lines[1].split(/\s+/);
        if (cols.length >= 2) cachedTotals.disk_total_bytes = parseInt(cols[1], 10) * 1024;
      }
    } catch { /* leave previous value */ }
  }
}

/** Collect a health snapshot from the OS and insert into the database. */
async function collectSnapshot(): Promise<void> {
  let cpu_percent = 0;
  let memory_used_bytes = 0;
  let disk_used_bytes = 0;
  let mail_queue_size = 0;
  let services_healthy = 0;
  const services_total = MONITORED_SERVICES.length;

  // CPU: read from /proc/stat (two samples 500ms apart)
  try {
    const read = () => {
      const stat = readFileSync("/proc/stat", "utf8");
      const line = stat.split("\n")[0]; // "cpu  user nice system idle ..."
      const parts = line.split(/\s+/).slice(1).map(Number);
      const idle = parts[3] + (parts[4] || 0); // idle + iowait
      const total = parts.reduce((a, b) => a + b, 0);
      return { idle, total };
    };
    const s1 = read();
    await new Promise((r) => setTimeout(r, 500));
    const s2 = read();
    const idleDelta = s2.idle - s1.idle;
    const totalDelta = s2.total - s1.total;
    if (totalDelta > 0) {
      const raw = ((totalDelta - idleDelta) / totalDelta) * 100;
      cpu_percent = Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
    }
  } catch { /* leave as 0 */ }

  // Memory: parse /proc/meminfo
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const total = meminfo.match(/MemTotal:\s+(\d+)/);
    const available = meminfo.match(/MemAvailable:\s+(\d+)/);
    if (total && available) {
      memory_used_bytes = (parseInt(total[1], 10) - parseInt(available[1], 10)) * 1024;
    }
  } catch { /* leave as 0 */ }

  // Disk: parse df output
  try {
    const dfOutput = execFileSync("df", ["-B1", "/"], { encoding: "utf8", timeout: 5000 });
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      const cols = lines[1].split(/\s+/);
      if (cols.length >= 3) disk_used_bytes = parseInt(cols[2], 10);
    }
  } catch { /* leave as 0 */ }

  // Mail queue size
  try {
    const queueOutput = execFileSync("/usr/sbin/postqueue", ["-p"], { encoding: "utf8", timeout: 5000 });
    // Last line: "-- X Kbytes in Y Requests." or "Mail queue is empty"
    const match = queueOutput.match(/(\d+)\s+Request/);
    mail_queue_size = match ? parseInt(match[1], 10) : 0;
  } catch { /* leave as 0 (postfix may not be installed) */ }

  // Service health: check each monitored service
  for (const svc of MONITORED_SERVICES) {
    try {
      const result = spawnSync("/usr/bin/systemctl", ["is-active", svc], {
        encoding: "utf8",
        timeout: 3000,
      });
      if (result.stdout?.trim() === "active") {
        services_healthy++;
      }
    } catch { /* not healthy */ }
  }

  // If every single metric is zero, collection is likely non-functional
  // (e.g. /proc not mounted, commands missing). Log a warning so operators
  // can diagnose why the dashboard shows all zeros — and skip the DB insert
  // so the next request retries instead of caching a useless row.
  if (cpu_percent === 0 && memory_used_bytes === 0 && disk_used_bytes === 0 && services_healthy === 0) {
    console.warn("Health snapshot: all metrics returned zero — skipping DB insert. Check /proc availability and installed commands.");
    return;
  }

  const pool = getDashboardPool();
  await pool.query(
    `INSERT INTO health_snapshots (cpu_percent, memory_used_bytes, disk_used_bytes, mail_queue_size, services_healthy, services_total)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [cpu_percent, memory_used_bytes, disk_used_bytes, mail_queue_size, services_healthy, services_total]
  );

  // Refresh system totals during collection (once per minute, not every poll)
  refreshSystemTotals();

  // Prune snapshots older than 7 days to prevent unbounded growth
  await pool.query(
    "DELETE FROM health_snapshots WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY)"
  );
}

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const pool = getDashboardPool();

    // Auto-collect: if no snapshot exists within the last COLLECT_INTERVAL,
    // collect one now. The dashboard polls this endpoint every ~10s, so
    // this naturally produces ~1 snapshot/minute without needing a cron job.
    // The Promise-based lock ensures only one collection runs at a time —
    // concurrent requests await the same promise instead of both collecting.
    const [recentRows] = await pool.query<HealthSnapshot[]>(
      "SELECT id FROM health_snapshots WHERE timestamp > DATE_SUB(NOW(), INTERVAL ? SECOND) LIMIT 1",
      [COLLECT_INTERVAL_MS / 1000]
    );

    if (recentRows.length === 0) {
      if (!collectingPromise) {
        // Outer deadline (60s) ensures the promise always settles, even if
        // collectSnapshot hangs on a stuck DB or unresponsive service. Without
        // this, a permanently pending promise would block all future collections.
        // The timer is cleared in .finally() to avoid an unhandled rejection
        // when collectSnapshot completes before the deadline fires.
        let deadlineTimer: ReturnType<typeof setTimeout>;
        const deadline = new Promise<void>((_, reject) => {
          deadlineTimer = setTimeout(() => reject(new Error("Collection deadline exceeded")), 60_000);
        });
        collectingPromise = Promise.race([collectSnapshot(), deadline])
          .catch((err) => console.error("Auto-collect snapshot failed:", err))
          .finally(() => {
            clearTimeout(deadlineTimer);
            collectingPromise = null;
          });
      }
      // Race against a short timeout so this request returns promptly
      // with stale data rather than waiting for the full collection.
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeout = new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, COLLECT_TIMEOUT_MS);
      });
      await Promise.race([
        collectingPromise!.then(() => clearTimeout(timeoutId)),
        timeout,
      ]);
    }

    // Eagerly populate system totals after process restart. On first request
    // after a fresh start, cachedTotals will be zeros if no collection has
    // run yet (e.g. a recent snapshot already existed in the DB). This
    // one-time sync call is cheap (~10ms) and only fires when needed.
    if (cachedTotals.memory_total_bytes === 0 && cachedTotals.disk_total_bytes === 0) {
      refreshSystemTotals();
    }

    // Get the latest health snapshot
    const [currentRows] = await pool.query<HealthSnapshot[]>(
      "SELECT * FROM health_snapshots ORDER BY timestamp DESC LIMIT 1"
    );

    // Get last 24 hours of snapshots for charting (time-based, not count-based)
    const [historyRows] = await pool.query<HealthSnapshot[]>(
      "SELECT * FROM health_snapshots WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR) ORDER BY timestamp ASC LIMIT 1440"
    );

    if (currentRows.length === 0) {
      return NextResponse.json({
        current: null,
        history: [],
        ...cachedTotals,
      });
    }

    return NextResponse.json({
      current: currentRows[0],
      history: historyRows,
      ...cachedTotals,
    });
  } catch (error) {
    console.error("Error fetching health stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch health statistics" },
      { status: 500 }
    );
  }
}
