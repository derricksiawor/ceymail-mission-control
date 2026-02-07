import { NextRequest, NextResponse } from "next/server";
import { execFileSync } from "child_process";

const ALLOWED_SERVICES = new Set([
  "postfix",
  "dovecot",
  "opendkim",
  "apache2",
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
      // Validate service name
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

      // Enable the service
      try {
        execFileSync("systemctl", ["enable", service], {
          encoding: "utf8",
          timeout: 15000,
        });
        enabled = true;
      } catch (enableErr: any) {
        error = `Failed to enable: ${enableErr.message}`;
      }

      // Start the service
      try {
        execFileSync("systemctl", ["start", service], {
          encoding: "utf8",
          timeout: 30000,
        });
        started = true;
      } catch (startErr: any) {
        error = (error ? error + "; " : "") + `Failed to start: ${startErr.message}`;
      }

      results.push({ name: service, enabled, started, error });
    }

    const allOk = results.every((r) => !r.error || !services[r.name]);

    return NextResponse.json({
      results,
      allOk,
    });
  } catch (error) {
    console.error("Error enabling services:", error);
    return NextResponse.json(
      { error: "Failed to enable services" },
      { status: 500 }
    );
  }
}
