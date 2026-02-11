import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, SESSION_MAX_AGE, verifySessionToken } from "@/lib/auth/session";

/**
 * GET /api/welcome/activate?token=<session-token>
 *
 * Sets the session cookie and returns 200 with auto-redirect HTML.
 *
 * We intentionally avoid NextResponse.redirect() here because writing
 * .env.local (for the Edge Runtime middleware) triggers a Next.js HMR
 * env reload.  If the reload races with a 307 redirect the browser may
 * discard the Set-Cookie header.  Instead we return a small HTML page
 * that:
 *   1. Has the Set-Cookie header (browser stores it on the 200).
 *   2. Fires a fetch to /api/welcome/persist-secret to write .env.local.
 *   3. After .env.local is written and the env reload settles, navigates
 *      to the dashboard via meta-refresh + JS fallback.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  // Verify the token is valid before setting it as a cookie
  const session = verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  // Return an HTML page that sets the cookie, persists the secret, then redirects.
  // After writing .env.local the Next.js dev server reloads env vars and
  // recompiles the middleware.  We poll /api/auth/me until the middleware
  // accepts our cookie, then redirect to the dashboard.
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Activating...</title>
  <meta http-equiv="refresh" content="25;url=/">
</head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui;background:#0a0a0a;color:#fff">
  <p>Activating session&hellip;</p>
  <script>
    (function() {
      var redirected = false;
      function go() {
        if (redirected) return;
        redirected = true;
        window.location.href = '/';
      }

      // Poll /api/auth/me until the middleware accepts our session cookie.
      // In production, persist-secret triggers a service restart so the Edge
      // middleware picks up SESSION_SECRET.  We poll with generous retries
      // to survive the ~3-5 second restart window.
      function poll(attempt) {
        if (redirected || attempt > 30) { go(); return; }
        fetch('/api/auth/me', { credentials: 'include' })
          .then(function(r) {
            if (r.ok) { go(); return; }
            setTimeout(function() { poll(attempt + 1); }, 600);
          })
          .catch(function() {
            // Connection refused during restart — keep trying
            setTimeout(function() { poll(attempt + 1); }, 600);
          });
      }

      // 1. Persist the secret to .env.local and trigger service restart
      fetch('/api/welcome/persist-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      })
        .then(function() { setTimeout(function() { poll(0); }, 2000); })
        .catch(function() { setTimeout(function() { poll(0); }, 2000); });
    })();
  </script>
</body>
</html>`;

  const response = new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return response;
}
