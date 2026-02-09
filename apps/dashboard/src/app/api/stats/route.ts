import { NextResponse } from "next/server";
import { execFileSync } from "child_process";
import { getDashboardPool } from "@/lib/db/connection";
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

function getSystemTotals(): { memory_total_bytes: number; disk_total_bytes: number } {
  let memory_total_bytes = 0;
  let disk_total_bytes = 0;

  // Memory total via /proc/meminfo (Linux) or sysctl (macOS)
  try {
    const memOutput = execFileSync("free", ["-b"], { encoding: "utf8", timeout: 5000 });
    const memMatch = memOutput.match(/Mem:\s+(\d+)/);
    if (memMatch) memory_total_bytes = parseInt(memMatch[1], 10);
  } catch {
    try {
      const sysctl = execFileSync("sysctl", ["-n", "hw.memsize"], { encoding: "utf8", timeout: 5000 }).trim();
      memory_total_bytes = parseInt(sysctl, 10);
    } catch { /* leave as 0 */ }
  }

  // Disk total via df
  try {
    const dfOutput = execFileSync("df", ["-B1", "/"], { encoding: "utf8", timeout: 5000 });
    const lines = dfOutput.trim().split("\n");
    if (lines.length >= 2) {
      const cols = lines[1].split(/\s+/);
      if (cols.length >= 2) disk_total_bytes = parseInt(cols[1], 10);
    }
  } catch {
    try {
      // macOS: df uses 512-byte blocks by default, use -b for bytes
      const dfOutput = execFileSync("df", ["-k", "/"], { encoding: "utf8", timeout: 5000 });
      const lines = dfOutput.trim().split("\n");
      if (lines.length >= 2) {
        const cols = lines[1].split(/\s+/);
        if (cols.length >= 2) disk_total_bytes = parseInt(cols[1], 10) * 1024;
      }
    } catch { /* leave as 0 */ }
  }

  return { memory_total_bytes, disk_total_bytes };
}

export async function GET() {
  try {
    const pool = getDashboardPool();

    // Get the latest health snapshot
    const [currentRows] = await pool.query<HealthSnapshot[]>(
      "SELECT * FROM health_snapshots ORDER BY timestamp DESC LIMIT 1"
    );

    // Get last 72 records for charting (72 hours if collected hourly)
    const [historyRows] = await pool.query<HealthSnapshot[]>(
      "SELECT * FROM health_snapshots ORDER BY timestamp DESC LIMIT 72"
    );

    // Get system totals (memory, disk) from the OS
    const totals = getSystemTotals();

    if (currentRows.length === 0) {
      return NextResponse.json({
        current: null,
        history: [],
        ...totals,
      });
    }

    // Reverse history so it's in chronological order for charting
    const history = historyRows.reverse();

    return NextResponse.json({
      current: currentRows[0],
      history: history,
      ...totals,
    });
  } catch (error) {
    console.error("Error fetching health stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch health statistics" },
      { status: 500 }
    );
  }
}
