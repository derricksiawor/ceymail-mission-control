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
  "spamd",
  "unbound",
  "rsyslog",
]);

// Services that conflict — enabling one should disable the other
const CONFLICTS: Record<string, string> = {
  nginx: "apache2",
  apache2: "nginx",
};

interface ServiceResult {
  name: string;
  enabled: boolean;
  started: boolean;
  error?: string;
}

/** Stop and disable a service (best-effort, non-fatal) */
function stopAndDisable(service: string): void {
  spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "stop", service], {
    encoding: "utf8",
    timeout: 15000,
  });
  spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "disable", service], {
    encoding: "utf8",
    timeout: 15000,
  });
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

      // Disable conflicting service before enabling this one (e.g. stop
      // apache2 before starting nginx — both bind port 80)
      const conflict = CONFLICTS[service];
      if (conflict) {
        stopAndDisable(conflict);
      }

      // OpenDKIM: remove conflicting systemd drop-ins that expect a Unix socket.
      // Our config uses TCP (inet:8891@localhost), so socket-fixup drop-ins cause
      // ExecStartPost failures (chown on non-existent socket file).
      // Always attempt cleanup — rm -rf is a no-op if the directory doesn't exist.
      if (service === "opendkim") {
        const rmResult = spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-rf", "/etc/systemd/system/opendkim.service.d"], {
          encoding: "utf8",
          timeout: 5000,
        });
        if (rmResult.status !== 0) {
          console.error("Failed to remove opendkim drop-in directory:", (rmResult.stderr || "").trim());
        }
        const reloadResult = spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "daemon-reload"], {
          encoding: "utf8",
          timeout: 10000,
        });
        if (reloadResult.status !== 0) {
          console.error("daemon-reload failed after opendkim drop-in cleanup:", (reloadResult.stderr || "").trim());
        }
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

        // Use restart (not start) — packages like dovecot auto-start with
        // default config during apt install; configs are written later by the
        // configure step, so we must restart to pick up the new config files.
        const startResult = spawnSync(
          "/usr/bin/sudo",
          ["/usr/bin/systemctl", "restart", service],
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
