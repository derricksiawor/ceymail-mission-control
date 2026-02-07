import { NextResponse } from "next/server";
import { getConfig, persistSessionSecret } from "@/lib/config/config";

/**
 * POST /api/welcome/persist-secret
 *
 * Writes the session secret from config.json to .env.local so the Edge
 * Runtime middleware can verify sessions.  Called from the activate page
 * AFTER the session cookie is already stored by the browser, avoiding the
 * race condition where an HMR env reload could interfere with Set-Cookie
 * processing on a redirect response.
 */
export async function POST() {
  const config = getConfig();
  if (!config?.session.secret) {
    return NextResponse.json({ error: "No config" }, { status: 400 });
  }

  persistSessionSecret(config.session.secret);
  return NextResponse.json({ ok: true });
}
