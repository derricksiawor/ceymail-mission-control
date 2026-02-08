import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { getDashboardPool } from "@/lib/db/connection";
import type { RowDataPacket } from "mysql2/promise";

interface QueueStats {
  active: number;
  deferred: number;
  hold: number;
  bounce: number;
  total: number;
}

interface HealthSnapshot extends RowDataPacket {
  mail_queue_size: number;
}

async function getFallbackQueueSize(): Promise<number> {
  try {
    const pool = getDashboardPool();
    const [rows] = await pool.query<HealthSnapshot[]>(
      "SELECT mail_queue_size FROM health_snapshots ORDER BY timestamp DESC LIMIT 1"
    );

    if (rows.length > 0) {
      return rows[0].mail_queue_size;
    }
    return 0;
  } catch {
    return 0;
  }
}

async function getQueueStats(): Promise<QueueStats> {
  // Try to get real queue data from postfix
  const result = spawnSync("/usr/sbin/postqueue", ["-j"], {
    encoding: "utf8",
    timeout: 10000,
  });

  if (result.status === 0 && result.stdout) {
    const lines = result.stdout.trim().split("\n").filter((line) => line.length > 0);

    const stats: QueueStats = {
      active: 0,
      deferred: 0,
      hold: 0,
      bounce: 0,
      total: 0,
    };

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        stats.total++;

        if (entry.queue_name === "active") {
          stats.active++;
        } else if (entry.queue_name === "deferred") {
          stats.deferred++;
        } else if (entry.queue_name === "hold") {
          stats.hold++;
        } else if (entry.queue_name === "bounce") {
          stats.bounce++;
        }
      } catch {
        continue;
      }
    }

    return stats;
  }

  // postqueue unavailable — fall back to health snapshot data
  const queueSize = await getFallbackQueueSize();

  return {
    active: 0,
    deferred: queueSize,
    hold: 0,
    bounce: 0,
    total: queueSize,
  };
}

export async function GET() {
  try {
    const stats = await getQueueStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching queue stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch queue statistics" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const { action, queueId } = body as { action?: unknown; queueId?: unknown };

    const validActions = ["flush", "clear"];
    if (!action || typeof action !== "string" || !validActions.includes(action)) {
      return NextResponse.json(
        { error: "Action must be one of: flush, clear" },
        { status: 400 }
      );
    }

    if (action === "flush") {
      const result = spawnSync("/usr/sbin/postqueue", ["-f"], {
        encoding: "utf8",
        timeout: 30000,
      });

      if (result.status !== 0) {
        const stderr = (result.stderr || "").trim();
        return NextResponse.json(
          { error: `Failed to flush mail queue: ${stderr || "postfix unavailable"}` },
          { status: 500 }
        );
      }

      return NextResponse.json({ message: "Mail queue flush initiated successfully" });
    } else if (action === "clear") {
      if (queueId && typeof queueId === "string") {
        if (!/^[A-F0-9]+$/i.test(queueId) || queueId.length > 20) {
          return NextResponse.json({ error: "Invalid queue ID format" }, { status: 400 });
        }

        const result = spawnSync("/usr/sbin/postsuper", ["-d", queueId], {
          encoding: "utf8",
          timeout: 10000,
        });

        if (result.status !== 0) {
          const stderr = (result.stderr || "").trim();
          return NextResponse.json(
            { error: `Failed to delete queue item: ${stderr || "postfix unavailable"}` },
            { status: 500 }
          );
        }

        return NextResponse.json({ message: "Queue item deleted successfully" });
      } else {
        const result = spawnSync("/usr/sbin/postsuper", ["-d", "ALL"], {
          encoding: "utf8",
          timeout: 30000,
        });

        if (result.status !== 0) {
          const stderr = (result.stderr || "").trim();
          return NextResponse.json(
            { error: `Failed to clear mail queue: ${stderr || "postfix unavailable"}` },
            { status: 500 }
          );
        }

        return NextResponse.json({ message: "Mail queue cleared successfully" });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error processing queue action:", error);
    return NextResponse.json(
      { error: "Failed to process queue action" },
      { status: 500 }
    );
  }
}
