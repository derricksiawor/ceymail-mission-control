import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";

interface ServiceStatus {
  name: string;
  status: "running" | "stopped" | "failed" | "unknown";
  uptime_seconds: number;
  uptime_formatted: string | null;
  memory_bytes: number;
  pid: number | null;
}

const SERVICES = [
  "postfix",
  "dovecot",
  "mariadb",
  "opendkim",
  "spamassassin",
  "apache2",
  "nginx",
  "unbound",
  "rsyslog",
];

const SYSTEMCTL = "/usr/bin/systemctl";

function getServiceStatus(service: string): ServiceStatus {
  const defaults: ServiceStatus = {
    name: service,
    status: "unknown",
    uptime_seconds: 0,
    uptime_formatted: null,
    memory_bytes: 0,
    pid: null,
  };

  try {
    if (!SERVICES.includes(service) || !/^[a-zA-Z0-9_-]+$/.test(service)) {
      return defaults;
    }

    // spawnSync does NOT throw on non-zero exit codes — safe for inactive/missing services
    const result = spawnSync(SYSTEMCTL, ["is-active", service], {
      encoding: "utf8",
      timeout: 5000,
    });

    const rawStatus = (result.stdout || "").trim();

    const statusMap: Record<string, ServiceStatus["status"]> = {
      active: "running",
      inactive: "stopped",
      failed: "failed",
      activating: "running",
      deactivating: "stopped",
    };
    const status = statusMap[rawStatus] || "unknown";

    let uptime_seconds = 0;
    let uptime_formatted: string | null = null;
    let pid: number | null = null;
    let memory_bytes = 0;

    if (status === "running") {
      const propsResult = spawnSync(
        SYSTEMCTL,
        ["show", service, "--property=ActiveEnterTimestamp,MainPID,MemoryCurrent"],
        { encoding: "utf8", timeout: 5000 }
      );

      if (propsResult.status === 0 && propsResult.stdout) {
        const propsOutput = propsResult.stdout.trim();

        const tsMatch = propsOutput.match(/ActiveEnterTimestamp=(.+)/);
        if (tsMatch && tsMatch[1] && tsMatch[1] !== "n/a") {
          const activeEnterTime = new Date(tsMatch[1]).getTime();
          const now = Date.now();
          const uptimeMs = now - activeEnterTime;
          if (uptimeMs > 0) {
            uptime_seconds = Math.floor(uptimeMs / 1000);
            const days = Math.floor(uptime_seconds / 86400);
            const hours = Math.floor((uptime_seconds % 86400) / 3600);
            const minutes = Math.floor((uptime_seconds % 3600) / 60);
            if (days > 0) {
              uptime_formatted = `${days}d ${hours}h ${minutes}m`;
            } else if (hours > 0) {
              uptime_formatted = `${hours}h ${minutes}m`;
            } else {
              uptime_formatted = `${minutes}m`;
            }
          }
        }

        const pidMatch = propsOutput.match(/MainPID=(\d+)/);
        if (pidMatch && pidMatch[1] && pidMatch[1] !== "0") {
          pid = parseInt(pidMatch[1], 10);
        }

        const memMatch = propsOutput.match(/MemoryCurrent=(\d+)/);
        if (memMatch && memMatch[1]) {
          memory_bytes = parseInt(memMatch[1], 10);
          if (memory_bytes > 1e15) memory_bytes = 0;
        }
      }
    }

    return {
      name: service,
      status,
      uptime_seconds,
      uptime_formatted,
      memory_bytes,
      pid,
    };
  } catch {
    return defaults;
  }
}

export async function GET() {
  try {
    const serviceStatuses: ServiceStatus[] = SERVICES.map(getServiceStatus);
    return NextResponse.json(serviceStatuses);
  } catch (error) {
    console.error("Error fetching service statuses:", error);
    return NextResponse.json(
      { error: "Failed to fetch service statuses" },
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

    const { service, action } = body as { service?: unknown; action?: unknown };

    if (!service || typeof service !== "string") {
      return NextResponse.json(
        { error: "Service name is required and must be a string" },
        { status: 400 }
      );
    }

    if (!SERVICES.includes(service)) {
      return NextResponse.json({ error: "Invalid service name" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(service)) {
      return NextResponse.json({ error: "Invalid service name format" }, { status: 400 });
    }

    const validActions = ["start", "stop", "restart"];
    if (!action || typeof action !== "string" || !validActions.includes(action)) {
      return NextResponse.json(
        { error: "Action must be one of: start, stop, restart" },
        { status: 400 }
      );
    }

    // Use systemctl directly — polkit rule authorizes ceymail-mc for whitelisted units
    const result = spawnSync(SYSTEMCTL, [action, service], {
      encoding: "utf8",
      timeout: 30000,
    });

    if (result.status !== 0) {
      const stderr = (result.stderr || "").trim();
      console.error(`Failed to ${action} ${service}: ${stderr}`);
      return NextResponse.json(
        { error: `Failed to ${action} service: ${stderr || "permission denied or service unavailable"}` },
        { status: 500 }
      );
    }

    const status = getServiceStatus(service);

    return NextResponse.json({
      message: `Service ${action} completed`,
      status: status,
    });
  } catch (error) {
    console.error("Error processing service action:", error);
    return NextResponse.json(
      { error: "Failed to process service action" },
      { status: 500 }
    );
  }
}
