import crypto from "crypto";
import { cookies } from "next/headers";
import { getConfig } from "@/lib/config/config";

const COOKIE_NAME = "mc-session";
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours in seconds

function getSecret(): string {
  // 1. Config file (primary)
  const config = getConfig();
  if (config?.session.secret) {
    return config.session.secret;
  }
  // 2. Env var fallback (SESSION_SECRET only — never use DB_PASSWORD as session
  // secret; if attacker obtains the DB password they could forge session tokens)
  if (process.env.SESSION_SECRET) {
    return process.env.SESSION_SECRET;
  }
  throw new Error("No session secret available. Complete the setup wizard first.");
}

function sign(payload: string): string {
  const hmac = crypto.createHmac("sha256", getSecret());
  hmac.update(payload);
  return hmac.digest("hex");
}

export interface SessionPayload {
  userId: number;
  username: string;
  role: string;
}

export function createSessionToken(payload: SessionPayload): string {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const data = JSON.stringify({ ...payload, exp: expiresAt });
  const encoded = Buffer.from(data).toString("base64url");
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const encoded = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);
  const expectedSig = sign(encoded);

  // Constant-time comparison to prevent timing attacks
  if (
    signature.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
  ) {
    return null;
  }

  try {
    const data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);

    if (!data.exp || data.exp < now) return null;
    if (!data.userId || !data.username || !data.role) return null;

    return {
      userId: data.userId,
      username: data.username,
      role: data.role,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = createSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  return verifySessionToken(cookie.value);
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export { COOKIE_NAME, SESSION_MAX_AGE };
