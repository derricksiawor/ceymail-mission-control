import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig } from "@/lib/config/config";
import { getDashboardPool } from "@/lib/db/connection";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken, COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth/session";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";

export async function POST(request: NextRequest) {
  try {
    // Guard: config must exist
    const config = getConfig();
    if (!config) {
      return NextResponse.json(
        { error: "Database not configured. Complete the database setup step first." },
        { status: 400 }
      );
    }

    // Guard: no admin must exist yet
    const pool = getDashboardPool();
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM dashboard_users"
    );

    if (existing[0].count > 0) {
      return NextResponse.json(
        { error: "An admin account already exists." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid or missing JSON body" },
        { status: 400 }
      );
    }

    const { username, email, password } = body as {
      username?: unknown;
      email?: unknown;
      password?: unknown;
    };

    // Validate username
    if (!username || typeof username !== "string") {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }
    if (username.length < 3 || username.length > 50) {
      return NextResponse.json(
        { error: "Username must be between 3 and 50 characters" },
        { status: 400 }
      );
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
      return NextResponse.json(
        { error: "Username may only contain letters, numbers, underscores, hyphens, and dots" },
        { status: 400 }
      );
    }

    // Validate email
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    // Validate password
    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters long" },
        { status: 400 }
      );
    }
    if (password.length > 128) {
      return NextResponse.json(
        { error: "Password must not exceed 128 characters" },
        { status: 400 }
      );
    }

    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);

    if (!hasUppercase || !hasLowercase || !hasDigit || !hasSpecial) {
      return NextResponse.json(
        {
          error:
            "Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character",
        },
        { status: 400 }
      );
    }

    // Hash and insert
    const passwordHash = hashPassword(password);

    const [result] = await pool.query<ResultSetHeader>(
      "INSERT INTO dashboard_users (username, password_hash, email, role) VALUES (?, ?, ?, 'admin')",
      [username, passwordHash, email]
    );

    // Mark setup as completed
    saveConfig({
      ...config,
      setupCompletedAt: new Date().toISOString(),
    });

    // Make session secret available in the current process (no .env.local
    // write here — that's deferred to the activate endpoint so the HMR env
    // reload doesn't destroy the wizard's React state before the redirect).
    process.env.SESSION_SECRET = config.session.secret;
    (globalThis as Record<string, unknown>).__MC_SESSION_SECRET = config.session.secret;

    // Create session token for auto-login
    const token = createSessionToken({
      userId: result.insertId,
      username: username,
      role: "admin",
    });

    // Return token in body — the client will redirect to
    // /api/welcome/activate?token=... which sets the cookie via a 302.
    // This avoids Next.js middleware stripping Set-Cookie from fetch() responses.
    const response = NextResponse.json(
      {
        message: "Admin account created successfully",
        sessionToken: token,
        user: {
          id: result.insertId,
          username,
          email,
          role: "admin",
        },
      },
      { status: 201 }
    );

    // Also set cookie on response as a best-effort (works with curl/direct clients)
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return response;
  } catch (error: any) {
    console.error("Create admin error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "An account with this username already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create admin account" },
      { status: 500 }
    );
  }
}
