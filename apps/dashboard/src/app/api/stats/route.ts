import { NextResponse } from "next/server";
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

    if (currentRows.length === 0) {
      return NextResponse.json({
        current: null,
        history: [],
      });
    }

    // Reverse history so it's in chronological order for charting
    const history = historyRows.reverse();

    return NextResponse.json({
      current: currentRows[0],
      history: history,
    });
  } catch (error) {
    console.error("Error fetching health stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch health statistics" },
      { status: 500 }
    );
  }
}
