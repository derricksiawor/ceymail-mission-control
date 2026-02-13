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

// Services whose configs are written by the configure step and need restart
// to pick up the new config (apt auto-starts them with default config).
// All other services (nginx, apache2, mariadb, rsyslog, unbound) just need
// "start" — their configs aren't changed by the wizard, and restarting
// nginx/apache2 would kill the reverse proxy connection this API uses.
const NEEDS_RESTART = new Set([
  "postfix",
  "dovecot",
  "opendkim",
  "spamassassin",
  "spamd",
]);

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

        // Services whose configs were written by the configure step need
        // restart to pick up changes (apt auto-starts them with defaults).
        // Other services (nginx, mariadb, etc.) just need start — restarting
        // the reverse proxy would kill the connection this API call uses.
        const action = NEEDS_RESTART.has(service) ? "restart" : "start";
        const startResult = spawnSync(
          "/usr/bin/sudo",
          ["/usr/bin/systemctl", action, service],
          { encoding: "utf8", timeout: 30000 }
        );

        if (startResult.status === 0) {
          started = true;

          // Unbound post-start: configure systemd-resolved to forward all DNS
          // queries through Unbound (127.0.0.1:53) instead of upstream/shared
          // resolvers. Without this, Spamhaus and other DNSBLs reject queries
          // from public resolvers (e.g. DigitalOcean's 67.207.67.x), causing
          // ALL inbound mail on port 25 to be blocked.
          //
          // This runs AFTER unbound starts successfully — if unbound failed,
          // we skip this to avoid leaving the server with no working DNS.
          //
          // Steps short-circuit on first failure: if the drop-in is written
          // (disabling the stub at 127.0.0.53) but resolv.conf isn't updated,
          // restarting systemd-resolved would kill the stub while resolv.conf
          // still points to it — total DNS loss. Bailing early keeps existing
          // DNS intact and surfaces the error to the caller.
          if (service === "unbound") {
            let dnsConfigError: string | undefined;

            // 1. Create the drop-in directory for systemd-resolved overrides
            const mkdirResult = spawnSync("/usr/bin/sudo", ["/usr/bin/mkdir", "-p", "/etc/systemd/resolved.conf.d"], {
              encoding: "utf8",
              timeout: 5000,
            });

            if (mkdirResult.status !== 0) {
              dnsConfigError = "Failed to create resolved.conf.d directory";
            }

            // 2. Write the drop-in config: use Unbound as the sole DNS upstream,
            //    clear fallback DNS, and disable the stub listener at 127.0.0.53
            //    so nothing competes with Unbound on the loopback interface.
            if (!dnsConfigError) {
              const dropIn = spawnSync(
                "/usr/bin/sudo",
                ["/usr/bin/tee", "/etc/systemd/resolved.conf.d/unbound.conf"],
                {
                  input: "[Resolve]\nDNS=127.0.0.1\nFallbackDNS=\nDNSStubListener=no\n",
                  encoding: "utf8",
                  timeout: 5000,
                }
              );
              if (dropIn.status !== 0) {
                dnsConfigError = "Failed to write resolved drop-in config";
              }
            }

            // 3. Replace /etc/resolv.conf with a static file pointing to Unbound.
            //    This is necessary because simply setting DNS= in the drop-in is
            //    NOT sufficient — DHCP link-level DNS servers with +DefaultRoute
            //    override global settings in systemd-resolved.
            if (!dnsConfigError) {
              const resolvConf = spawnSync(
                "/usr/bin/sudo",
                ["/usr/bin/tee", "/etc/resolv.conf"],
                {
                  input: "nameserver 127.0.0.1\noptions edns0\n",
                  encoding: "utf8",
                  timeout: 5000,
                }
              );
              if (resolvConf.status !== 0) {
                dnsConfigError = "Failed to write /etc/resolv.conf";
                // Rollback: remove the drop-in written in step 2 to prevent
                // latent DNS breakage on reboot. If the drop-in persists with
                // DNSStubListener=no but resolv.conf still points to 127.0.0.53,
                // the next systemd-resolved restart would kill the stub → no DNS.
                spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/systemd/resolved.conf.d/unbound.conf"], {
                  encoding: "utf8",
                  timeout: 5000,
                });
              }
            }

            // 4. Restart systemd-resolved so it picks up the new config
            if (!dnsConfigError) {
              const resolvedResult = spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "restart", "systemd-resolved"], {
                encoding: "utf8",
                timeout: 10000,
              });
              if (resolvedResult.status !== 0) {
                dnsConfigError = "Failed to restart systemd-resolved";
              }
            }

            if (dnsConfigError) {
              error = `Unbound started but DNS forwarding config failed: ${dnsConfigError}`;
            }
          }
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
