import { NextRequest, NextResponse } from "next/server";
import { getConfig, saveConfig, persistSessionSecret } from "@/lib/config/config";
import { getDashboardPool } from "@/lib/db/connection";
import { hashPassword, validatePasswordComplexity } from "@/lib/auth/password";
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

    const pool = getDashboardPool();

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
    const passwordValidationError = validatePasswordComplexity(password);
    if (passwordValidationError) {
      return NextResponse.json({ error: passwordValidationError }, { status: 400 });
    }

    // Hash and insert atomically using a transaction to prevent race conditions
    const passwordHash = hashPassword(password);

    const conn = await pool.getConnection();
    let result: ResultSetHeader;
    try {
      await conn.beginTransaction();

      // Check admin count inside the transaction for atomicity
      const [existing] = await conn.query<RowDataPacket[]>(
        "SELECT COUNT(*) as count FROM dashboard_users FOR UPDATE"
      );

      if (existing[0].count > 0) {
        await conn.rollback();
        conn.release();
        return NextResponse.json(
          { error: "An admin account already exists." },
          { status: 403 }
        );
      }

      const [insertResult] = await conn.query<ResultSetHeader>(
        "INSERT INTO dashboard_users (username, password_hash, email, role) VALUES (?, ?, ?, 'admin')",
        [username, passwordHash, email]
      );
      result = insertResult;

      await conn.commit();
    } catch (txError) {
      await conn.rollback();
      throw txError;
    } finally {
      conn.release();
    }

    // Mark setup as completed
    saveConfig({
      ...config,
      setupCompletedAt: new Date().toISOString(),
    });

    // Make session secret available in the current process and persist to
    // .env.local so the Edge Runtime middleware can verify sessions after
    // a server restart. This is safe to do here because the wizard is on
    // the final step (SetupComplete) which immediately redirects to "/".
    process.env.SESSION_SECRET = config.session.secret;
    (globalThis as Record<string, unknown>).__MC_SESSION_SECRET = config.session.secret;
    persistSessionSecret(config.session.secret);

    // Create session token for auto-login
    const token = createSessionToken({
      userId: result.insertId,
      username: username,
      role: "admin",
    });

    // Set cookie directly on the response (do not expose token in body)
    const response = NextResponse.json(
      {
        message: "Admin account created successfully",
        user: {
          id: result.insertId,
          username,
          email,
          role: "admin",
        },
      },
      { status: 201 }
    );

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return response;
  } catch (error) {
    console.error("Create admin error:", error);

    const dbError = error as { code?: string };
    if (dbError.code === "ER_DUP_ENTRY") {
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
