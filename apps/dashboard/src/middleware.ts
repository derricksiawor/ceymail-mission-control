import { NextRequest, NextResponse } from "next/server";

/* ──────────────────────────────────────────────
 * Session verification (Web Crypto API for edge)
 * ────────────────────────────────────────────── */

const COOKIE_NAME = "mc-session"; // edge-env-refresh 1770483136753

function getSecret(): string {
  // 1. Env var (set externally in production, or mutated by API routes in dev)
  // 2. globalThis bridge (API routes set this after provisioning – works in dev
  //    where Edge Runtime emulation shares the same Node.js process)
  // 3. DB_PASSWORD legacy fallback
  const secret =
    process.env.SESSION_SECRET ||
    (globalThis as Record<string, unknown>).__MC_SESSION_SECRET ||
    process.env.DB_PASSWORD;
  // Return empty string when unconfigured – session verification will
  // naturally fail, so only public routes (login, setup, welcome) remain accessible.
  return typeof secret === "string" ? secret : "";
}

function hexEncode(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return hexEncode(signature);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifySessionToken(
  token: string
): Promise<{ userId: number; username: string; role: string } | null> {
  const secret = getSecret();
  if (!secret) return null;

  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const encoded = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  const expectedSig = await hmacSign(encoded, secret);

  if (!constantTimeEqual(signature, expectedSig)) {
    return null;
  }

  try {
    // Convert base64url to standard base64 with padding for atob() compatibility
    let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (b64.length % 4)) % 4;
    b64 += "=".repeat(padLen);
    const decoded = atob(b64);
    const data = JSON.parse(decoded);
    const now = Math.floor(Date.now() / 1000);

    if (!data.exp || data.exp < now) return null;
    if (!data.userId || !data.username || !data.role) return null;

    return { userId: data.userId, username: data.username, role: data.role };
  } catch {
    return null;
  }
}

/* ──────────────────────────────────────────────
 * In-memory sliding-window rate limiter
 * ────────────────────────────────────────────── */

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateBucket>();

let lastCleanup = Date.now();
function cleanupStale() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, bucket] of rateLimitStore) {
    if (bucket.resetAt < now) rateLimitStore.delete(key);
  }
}

function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  cleanupStale();
  const now = Date.now();
  const bucket = rateLimitStore.get(key);

  if (!bucket || bucket.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  bucket.count++;
  return bucket.count > maxRequests;
}

/* ──────────────────────────────────────────────
 * Rate limit tiers (requests per window)
 * ────────────────────────────────────────────── */

const RATE_LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
  "POST:/api/auth/login": { maxRequests: 10, windowMs: 60_000 },
  "POST:/api/auth/setup": { maxRequests: 5, windowMs: 60_000 },
  "POST:/api/services": { maxRequests: 5, windowMs: 60_000 },
  "POST:/api/queue": { maxRequests: 5, windowMs: 60_000 },
  "POST:/api/domains": { maxRequests: 20, windowMs: 60_000 },
  "POST:/api/users": { maxRequests: 20, windowMs: 60_000 },
  "POST:/api/aliases": { maxRequests: 20, windowMs: 60_000 },
  "PATCH:/api/users": { maxRequests: 20, windowMs: 60_000 },
  "DELETE:/api/domains": { maxRequests: 20, windowMs: 60_000 },
  "DELETE:/api/users": { maxRequests: 20, windowMs: 60_000 },
  "DELETE:/api/aliases": { maxRequests: 20, windowMs: 60_000 },
  "GET:/api/domains": { maxRequests: 120, windowMs: 60_000 },
  "GET:/api/users": { maxRequests: 120, windowMs: 60_000 },
  "GET:/api/aliases": { maxRequests: 120, windowMs: 60_000 },
  "GET:/api/logs": { maxRequests: 120, windowMs: 60_000 },
  "GET:/api/stats": { maxRequests: 120, windowMs: 60_000 },
  "GET:/api/queue": { maxRequests: 120, windowMs: 60_000 },
  "GET:/api/services": { maxRequests: 120, windowMs: 60_000 },
  "GET:/api/welcome/status": { maxRequests: 30, windowMs: 60_000 },
  "POST:/api/welcome/test-db": { maxRequests: 10, windowMs: 60_000 },
  "POST:/api/welcome/provision": { maxRequests: 5, windowMs: 60_000 },
  "POST:/api/welcome/create-admin": { maxRequests: 5, windowMs: 60_000 },
  "GET:/api/welcome/activate": { maxRequests: 10, windowMs: 60_000 },
  "POST:/api/welcome/persist-secret": { maxRequests: 5, windowMs: 60_000 },
  "GET:/api/install/status": { maxRequests: 30, windowMs: 60_000 },
  "POST:/api/install/status": { maxRequests: 5, windowMs: 60_000 },
  "DELETE:/api/install/status": { maxRequests: 5, windowMs: 60_000 },
  "GET:/api/install/system-check": { maxRequests: 30, windowMs: 60_000 },
  "GET:/api/install/packages": { maxRequests: 30, windowMs: 60_000 },
  "POST:/api/install/packages": { maxRequests: 30, windowMs: 60_000 },
  "POST:/api/install/services": { maxRequests: 10, windowMs: 60_000 },
  "POST:/api/install/permissions": { maxRequests: 10, windowMs: 60_000 },
  "POST:/api/install/configure": { maxRequests: 10, windowMs: 60_000 },
  "POST:/api/install/ssl": { maxRequests: 5, windowMs: 60_000 },
  "POST:/api/install/database": { maxRequests: 5, windowMs: 60_000 },
  "GET:/api/dkim": { maxRequests: 60, windowMs: 60_000 },
  "POST:/api/dkim": { maxRequests: 10, windowMs: 60_000 },
  "DELETE:/api/dkim": { maxRequests: 10, windowMs: 60_000 },
  "GET:/api/webmail": { maxRequests: 60, windowMs: 60_000 },
  "POST:/api/webmail": { maxRequests: 5, windowMs: 60_000 },
  "GET:/api/settings": { maxRequests: 60, windowMs: 60_000 },
  "PATCH:/api/settings": { maxRequests: 20, windowMs: 60_000 },
  "POST:/api/settings/factory-reset": { maxRequests: 1, windowMs: 60_000 },
  "GET:/api/backup": { maxRequests: 30, windowMs: 60_000 },
  "POST:/api/backup": { maxRequests: 3, windowMs: 60_000 },
  "DELETE:/api/backup": { maxRequests: 10, windowMs: 60_000 },
};

/* ──────────────────────────────────────────────
 * Allowed HTTP methods per API route
 * ────────────────────────────────────────────── */

// Dynamic route method sets (not in the static map)
const BACKUP_DOWNLOAD_METHODS = new Set(["GET"]);
const BACKUP_DOWNLOAD_PATTERN = /^\/api\/backup\/[^/]+\/download$/;

const ALLOWED_METHODS: Record<string, Set<string>> = {
  "/api/auth/login": new Set(["POST"]),
  "/api/auth/logout": new Set(["POST"]),
  "/api/auth/me": new Set(["GET"]),
  "/api/auth/setup": new Set(["GET", "POST"]),
  "/api/domains": new Set(["GET", "POST", "DELETE"]),
  "/api/users": new Set(["GET", "POST", "PATCH", "DELETE"]),
  "/api/aliases": new Set(["GET", "POST", "DELETE"]),
  "/api/logs": new Set(["GET"]),
  "/api/stats": new Set(["GET"]),
  "/api/queue": new Set(["GET", "POST"]),
  "/api/services": new Set(["GET", "POST"]),
  "/api/welcome/status": new Set(["GET"]),
  "/api/welcome/test-db": new Set(["POST"]),
  "/api/welcome/provision": new Set(["POST"]),
  "/api/welcome/create-admin": new Set(["POST"]),
  "/api/welcome/activate": new Set(["GET"]),
  "/api/welcome/persist-secret": new Set(["POST"]),
  "/api/install/status": new Set(["GET", "POST", "DELETE"]),
  "/api/install/system-check": new Set(["GET"]),
  "/api/install/packages": new Set(["GET", "POST"]),
  "/api/install/services": new Set(["POST"]),
  "/api/install/permissions": new Set(["POST"]),
  "/api/install/configure": new Set(["POST"]),
  "/api/install/ssl": new Set(["POST"]),
  "/api/install/database": new Set(["POST"]),
  "/api/dkim": new Set(["GET", "POST", "DELETE"]),
  "/api/webmail": new Set(["GET", "POST"]),
  "/api/settings": new Set(["GET", "PATCH"]),
  "/api/settings/factory-reset": new Set(["POST"]),
  "/api/backup": new Set(["GET", "POST", "DELETE"]),
};

/* ──────────────────────────────────────────────
 * Routes that do NOT require authentication
 * ────────────────────────────────────────────── */

const PUBLIC_API_ROUTES = new Set([
  "/api/auth/login",
  "/api/auth/setup",
  "/api/welcome/status",
  "/api/welcome/test-db",
  "/api/welcome/provision",
  "/api/welcome/create-admin",
  "/api/welcome/activate",
  "/api/welcome/persist-secret",
]);

function getAllowedOrigin(origin: string | null, request: NextRequest): string {
  if (!origin) return "";
  try {
    const url = new URL(origin);
    const hostHeader = request.headers.get("host") || "localhost";
    const selfHostname = hostHeader.split(":")[0];
    // Allow exact same-host match
    if (url.hostname === selfHostname) {
      return origin;
    }
    // Allow localhost/127.0.0.1 only in development
    if (process.env.NODE_ENV === "development") {
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        return origin;
      }
    }
  } catch {
    // Invalid origin URL
  }
  return "";
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "0");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return response;
}

export async function middleware(request: NextRequest) {
  const method = request.method;
  const { pathname } = request.nextUrl;

  // Only process API routes
  if (!pathname.startsWith("/api/")) {
    return addSecurityHeaders(NextResponse.next());
  }

  // gRPC proxy routes - still require auth
  if (pathname.startsWith("/api/grpc/")) {
    const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;
    if (!sessionCookie) {
      return addSecurityHeaders(NextResponse.json({ error: "Authentication required" }, { status: 401 }));
    }
    const session = await verifySessionToken(sessionCookie);
    if (!session) {
      return addSecurityHeaders(NextResponse.json({ error: "Session expired or invalid" }, { status: 401 }));
    }
    return addSecurityHeaders(NextResponse.next());
  }

  // ── Block TRACE / TRACK methods ──
  if (method === "TRACE" || method === "TRACK") {
    return addSecurityHeaders(NextResponse.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET, POST, PATCH, DELETE" } }
    ));
  }

  // ── Block OPTIONS (handle CORS preflight) ──
  if (method === "OPTIONS") {
    const requestOrigin = request.headers.get("origin");
    const allowedOrigin = getAllowedOrigin(requestOrigin, request);
    const preflight = new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
    return addSecurityHeaders(preflight);
  }

  // ── Method validation ──
  const routePath = pathname.replace(/\/$/, "");
  // Check static routes first, then dynamic patterns
  const allowedMethods =
    ALLOWED_METHODS[routePath] ??
    (BACKUP_DOWNLOAD_PATTERN.test(routePath)
      ? BACKUP_DOWNLOAD_METHODS
      : undefined);
  if (allowedMethods && !allowedMethods.has(method)) {
    return addSecurityHeaders(NextResponse.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: Array.from(allowedMethods).join(", ") } }
    ));
  }

  // ── Content-Type enforcement on write methods ──
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    // CSRF protection: require Content-Type header on all mutations.
    // Browsers cannot send application/json from forms or simple requests,
    // so this blocks cross-origin form submissions (CSRF).
    if (method !== "DELETE") {
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        return addSecurityHeaders(NextResponse.json(
          { error: "Content-Type must be application/json" },
          { status: 415 }
        ));
      }
    }
  }

  // ── Rate limiting ──
  const clientIp = getClientIp(request);
  const rateLimitKey = `${method}:${routePath}`;
  const limits = RATE_LIMITS[rateLimitKey];

  if (limits) {
    const storeKey = `${clientIp}:${rateLimitKey}`;
    if (isRateLimited(storeKey, limits.maxRequests, limits.windowMs)) {
      return addSecurityHeaders(NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": String(limits.maxRequests),
          },
        }
      ));
    }
  }

  // ── Authentication enforcement ──
  if (!PUBLIC_API_ROUTES.has(routePath)) {
    const sessionCookie = request.cookies.get(COOKIE_NAME)?.value;

    if (!sessionCookie) {
      return addSecurityHeaders(NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      ));
    }

    const secret = getSecret();
    const session = secret ? await verifySessionToken(sessionCookie) : null;
    if (!session) {
      // Never delete the cookie here — the secret may be temporarily
      // unavailable during env reloads (e.g. after first-run wizard writes
      // .env.local).  Stale cookies expire naturally via maxAge; explicit
      // deletion is handled by the logout endpoint.
      return addSecurityHeaders(NextResponse.json(
        { error: "Session expired or invalid" },
        { status: 401 }
      ));
    }

    // Pass session info to downstream API routes via request headers.
    // We MUST use the request header forwarding pattern so downstream
    // route handlers can read these via request.headers.get().
    // Also strip any client-supplied x-user-* headers to prevent
    // privilege escalation (a viewer sending x-user-role: admin).
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-user-id");
    requestHeaders.delete("x-user-name");
    requestHeaders.delete("x-user-role");
    requestHeaders.set("x-user-id", String(session.userId));
    requestHeaders.set("x-user-name", session.username);
    requestHeaders.set("x-user-role", session.role);

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    const origin = request.headers.get("origin");
    if (origin) {
      const allowedOrigin = getAllowedOrigin(origin, request);
      response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
    }

    return addSecurityHeaders(response);
  }

  // ── Add CORS headers to public response ──
  const response = NextResponse.next();
  const origin = request.headers.get("origin");
  if (origin) {
    const allowedOrigin = getAllowedOrigin(origin, request);
    response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return addSecurityHeaders(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
