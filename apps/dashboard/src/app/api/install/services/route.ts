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

            // 3. Break the /etc/resolv.conf symlink.
            //    On Ubuntu, /etc/resolv.conf is a symlink to
            //    /run/systemd/resolve/stub-resolv.conf. Writing via `tee`
            //    follows the symlink — then systemd-resolved overwrites the
            //    target on restart, reverting our changes. Removing the
            //    symlink first lets step 4 create a persistent static file.
            if (!dnsConfigError) {
              const rmLink = spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/resolv.conf"], {
                encoding: "utf8",
                timeout: 5000,
              });
              if (rmLink.status !== 0) {
                dnsConfigError = "Failed to remove /etc/resolv.conf symlink";
                // Rollback drop-in
                spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/systemd/resolved.conf.d/unbound.conf"], {
                  encoding: "utf8",
                  timeout: 5000,
                });
              }
            }

            // 4. Write a static /etc/resolv.conf pointing to Unbound.
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
                // Rollback: step 3 removed the symlink, so the server now has
                // NO /etc/resolv.conf at all. Restore the original symlink to
                // the stub resolver so DNS keeps working.
                spawnSync("/usr/bin/sudo", [
                  "/usr/bin/ln", "-sf",
                  "/run/systemd/resolve/stub-resolv.conf",
                  "/etc/resolv.conf",
                ], {
                  encoding: "utf8",
                  timeout: 5000,
                });
                // Also remove the drop-in written in step 2 to prevent
                // latent DNS breakage on reboot.
                spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/systemd/resolved.conf.d/unbound.conf"], {
                  encoding: "utf8",
                  timeout: 5000,
                });
              }
            }

            // 5. Update the Postfix chroot resolv.conf.
            //    Postfix runs in a chroot at /var/spool/postfix/ and uses its
            //    own copy of resolv.conf for DNS. Without this, Postfix still
            //    queries the old stub at 127.0.0.53 (which we just disabled),
            //    causing all outbound mail to defer with "Host not found".
            if (!dnsConfigError) {
              const chrootResolv = spawnSync(
                "/usr/bin/sudo",
                ["/usr/bin/tee", "/var/spool/postfix/etc/resolv.conf"],
                {
                  input: "nameserver 127.0.0.1\noptions edns0\n",
                  encoding: "utf8",
                  timeout: 5000,
                }
              );
              if (chrootResolv.status !== 0) {
                dnsConfigError = "Failed to write Postfix chroot resolv.conf";
                // Rollback steps 2-4: restore the original symlink and remove
                // the drop-in so the partially-committed config doesn't take
                // effect on the next reboot.
                spawnSync("/usr/bin/sudo", [
                  "/usr/bin/ln", "-sf",
                  "/run/systemd/resolve/stub-resolv.conf",
                  "/etc/resolv.conf",
                ], { encoding: "utf8", timeout: 5000 });
                spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/systemd/resolved.conf.d/unbound.conf"], {
                  encoding: "utf8",
                  timeout: 5000,
                });
              }
            }

            // 6. Restart systemd-resolved so it picks up the new config
            if (!dnsConfigError) {
              const resolvedResult = spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "restart", "systemd-resolved"], {
                encoding: "utf8",
                timeout: 10000,
              });
              if (resolvedResult.status !== 0) {
                dnsConfigError = "Failed to restart systemd-resolved";
                // Rollback steps 2-5: restore the symlink, remove the drop-in,
                // and revert the Postfix chroot so the partially-committed config
                // doesn't silently take effect on reboot.
                spawnSync("/usr/bin/sudo", [
                  "/usr/bin/ln", "-sf",
                  "/run/systemd/resolve/stub-resolv.conf",
                  "/etc/resolv.conf",
                ], { encoding: "utf8", timeout: 5000 });
                spawnSync("/usr/bin/sudo", ["/usr/bin/rm", "-f", "/etc/systemd/resolved.conf.d/unbound.conf"], {
                  encoding: "utf8",
                  timeout: 5000,
                });
                // Revert the Postfix chroot resolv.conf (written in step 5)
                // back to the stub resolver at 127.0.0.53 — since we just
                // restored the symlink, the stub is still active.
                spawnSync(
                  "/usr/bin/sudo",
                  ["/usr/bin/tee", "/var/spool/postfix/etc/resolv.conf"],
                  {
                    input: "nameserver 127.0.0.53\noptions edns0\n",
                    encoding: "utf8",
                    timeout: 5000,
                  }
                );
              }
            }

            // 7. Restart Postfix so it reads the updated chroot resolv.conf —
            //    but only if Postfix is actually running. If the user didn't
            //    select Postfix, there's nothing to restart.
            if (!dnsConfigError) {
              const pfCheck = spawnSync("/usr/bin/systemctl", ["is-active", "postfix"], {
                encoding: "utf8",
                timeout: 3000,
              });
              if (pfCheck.stdout?.trim() === "active") {
                const postfixRestart = spawnSync("/usr/bin/sudo", ["/usr/bin/systemctl", "restart", "postfix"], {
                  encoding: "utf8",
                  timeout: 15000,
                });
                if (postfixRestart.status !== 0) {
                  // Non-fatal: the chroot file is correct, postfix will pick it
                  // up on next restart. Log but don't fail the DNS config.
                  console.error("Warning: could not restart postfix after DNS update:", (postfixRestart.stderr || "").trim());
                }
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
