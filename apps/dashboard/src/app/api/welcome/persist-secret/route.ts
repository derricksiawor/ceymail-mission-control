import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { getConfig, persistSessionSecret } from "@/lib/config/config";

/**
 * POST /api/welcome/persist-secret
 *
 * Writes the session secret from config.json to .env.local (both the local
 * working directory and the systemd EnvironmentFile location) so the Edge
 * Runtime middleware can verify sessions.
 *
 * In production, the Edge middleware can only read env vars — not config
 * files.  Since env vars are captured at process start, we must restart
 * the service so the middleware picks up the new SESSION_SECRET.
 *
 * Called from the activate page AFTER the session cookie is already stored
 * by the browser.  The activate page polls /api/auth/me until the restarted
 * service accepts the cookie, then redirects to the dashboard.
 */
export async function POST() {
  const config = getConfig();
  if (!config?.session.secret) {
    return NextResponse.json({ error: "No config" }, { status: 400 });
  }

  // If SESSION_SECRET is already in the environment AND matches the current
  // config, .env.local is already correct — no restart needed. This prevents
  // post-setup abuse (DoS via repeated service restarts) while still allowing
  // re-runs after a factory reset (where config has a new secret).
  if (process.env.SESSION_SECRET === config.session.secret) {
    return NextResponse.json({ ok: true, restarting: false });
  }

  // Write SESSION_SECRET to both .env.local locations (cwd + systemd EnvironmentFile).
  persistSessionSecret(config.session.secret);

  // In production, schedule a service restart so the Edge middleware picks up
  // the new SESSION_SECRET from the EnvironmentFile.  The 1-second delay
  // ensures this HTTP response is fully sent before the process exits.
  if (process.env.NODE_ENV === "production") {
    setTimeout(() => {
      const child = spawn(
        "/usr/bin/sudo",
        ["/usr/bin/systemctl", "restart", "ceymail-dashboard"],
        { stdio: "ignore", detached: true }
      );
      child.unref();
    }, 1000);
  }

  return NextResponse.json({ ok: true, restarting: process.env.NODE_ENV === "production" });
}
