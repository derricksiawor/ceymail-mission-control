import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import { requireAdmin } from "@/lib/api/helpers";

const ALLOWED_SERVICES = new Set([
  "postfix",
  "dovecot",
  "opendkim",
  "apache2",
  "nginx",
  "mariadb",
  "spamassassin",
  "unbound",
  "rsyslog",
]);

interface ServiceResult {
  name: string;
  enabled: boolean;
  started: boolean;
  error?: string;
}

// POST - Enable and start selected services
export async function POST(request: NextRequest) {
  try {
    const denied = requireAdmin(request);
    if (denied) return denied;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { services } = body as { services?: Record<string, boolean> };

    if (!services || typeof services !== "object") {
      return NextResponse.json({ error: "Services map is required" }, { status: 400 });
    }

    const results: ServiceResult[] = [];

    for (const [service, shouldEnable] of Object.entries(services)) {
      if (!ALLOWED_SERVICES.has(service)) {
        results.push({ name: service, enabled: false, started: false, error: "Not an allowed service" });
        continue;
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(service)) {
        results.push({ name: service, enabled: false, started: false, error: "Invalid service name" });
        continue;
      }

      if (!shouldEnable) {
        results.push({ name: service, enabled: false, started: false });
        continue;
      }

      let enabled = false;
      let started = false;
      let error: string | undefined;

      // Enable the service via sudo
      const enableResult = spawnSync(
        "/usr/bin/sudo",
        ["/usr/bin/systemctl", "enable", service],
        { encoding: "utf8", timeout: 15000 }
      );

      if (enableResult.status === 0) {
        enabled = true;

        // Only start if enable succeeded — starting without enable creates
        // a false positive (service runs until reboot but won't persist)
        const startResult = spawnSync(
          "/usr/bin/sudo",
          ["/usr/bin/systemctl", "start", service],
          { encoding: "utf8", timeout: 30000 }
        );

        if (startResult.status === 0) {
          started = true;
        } else {
          error = `Failed to start: ${(startResult.stderr || "").trim() || "unknown error"}`;
        }
      } else {
        error = `Failed to enable: ${(enableResult.stderr || "").trim() || "unknown error"}`;
      }

      results.push({ name: service, enabled, started, error });
    }

    const allOk = results.every((r) => !r.error || !services[r.name]);

    return NextResponse.json({ results, allOk });
  } catch (error) {
    console.error("Error enabling services:", error);
    return NextResponse.json(
      { error: "Failed to enable services" },
      { status: 500 }
    );
  }
}
