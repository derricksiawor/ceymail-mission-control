import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";

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
  "unbound",
  "rsyslog",
];

function getServiceStatus(service: string): ServiceStatus {
  try {
    // Validate service name to prevent command injection
    if (!SERVICES.includes(service)) {
      throw new Error("Invalid service name");
    }

    // Additional regex check for safety
    if (!/^[a-zA-Z0-9_-]+$/.test(service)) {
      throw new Error("Invalid service name format");
    }

    // Check if service is active
    const rawStatus = execFileSync("systemctl", ["is-active", service], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();

    // Normalize systemctl status to our internal status type
    const statusMap: Record<string, ServiceStatus["status"]> = {
      active: "running",
      inactive: "stopped",
      failed: "failed",
      activating: "running",
      deactivating: "stopped",
    };
    const status = statusMap[rawStatus] || "unknown";

    // Get uptime, PID, and memory information
    let uptime_seconds = 0;
    let uptime_formatted: string | null = null;
    let pid: number | null = null;
    let memory_bytes = 0;

    try {
      const propsOutput = execFileSync(
        "systemctl",
        ["show", service, "--property=ActiveEnterTimestamp,MainPID,MemoryCurrent"],
        { encoding: "utf8", timeout: 5000 }
      ).trim();

      // Parse ActiveEnterTimestamp
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

      // Parse MainPID
      const pidMatch = propsOutput.match(/MainPID=(\d+)/);
      if (pidMatch && pidMatch[1] && pidMatch[1] !== "0") {
        pid = parseInt(pidMatch[1], 10);
      }

      // Parse MemoryCurrent
      const memMatch = propsOutput.match(/MemoryCurrent=(\d+)/);
      if (memMatch && memMatch[1]) {
        memory_bytes = parseInt(memMatch[1], 10);
        // MemoryCurrent can return max uint64 if not supported
        if (memory_bytes > 1e15) memory_bytes = 0;
      }
    } catch {
      // If we can't get details, leave defaults
    }

    return {
      name: service,
      status: status as ServiceStatus["status"],
      uptime_seconds,
      uptime_formatted,
      memory_bytes,
      pid,
    };
  } catch (error) {
    // Service not found or not installed, return unknown status
    return {
      name: service,
      status: "unknown",
      uptime_seconds: 0,
      uptime_formatted: null,
      memory_bytes: 0,
      pid: null,
    };
  }
}

export async function GET() {
  try {
    const serviceStatuses: ServiceStatus[] = [];

    for (const service of SERVICES) {
      const status = getServiceStatus(service);
      serviceStatuses.push(status);
    }

    return NextResponse.json(serviceStatuses);
  } catch (error) {
    console.error("Error fetching service statuses:", error);
    return NextResponse.json(
      { error: "Failed to fetch service statuses" },
      { status: 500 }
    );
  }
}

// POST - Start, stop, or restart a service
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

    // Validate service name
    if (!service || typeof service !== "string") {
      return NextResponse.json(
        { error: "Service name is required and must be a string" },
        { status: 400 }
      );
    }

    // Validate service name is in whitelist
    if (!SERVICES.includes(service)) {
      return NextResponse.json(
        { error: "Invalid service name" },
        { status: 400 }
      );
    }

    // Additional regex check for safety
    if (!/^[a-zA-Z0-9_-]+$/.test(service)) {
      return NextResponse.json(
        { error: "Invalid service name format" },
        { status: 400 }
      );
    }

    // Validate action
    const validActions = ["start", "stop", "restart"];
    if (!action || typeof action !== "string" || !validActions.includes(action)) {
      return NextResponse.json(
        { error: "Action must be one of: start, stop, restart" },
        { status: 400 }
      );
    }

    // Execute the systemctl command
    try {
      execFileSync("systemctl", [action, service], {
        encoding: "utf8",
        timeout: 30000,
      });

      // Get the updated status
      const status = getServiceStatus(service);

      return NextResponse.json({
        message: `Service ${action} completed`,
        status: status,
      });
    } catch (execError) {
      console.error(`Error executing ${action} on ${service}:`, execError);
      return NextResponse.json(
        { error: `Failed to ${action} service` },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error processing service action:", error);
    return NextResponse.json(
      { error: "Failed to process service action" },
      { status: 500 }
    );
  }
}
