import { NextRequest, NextResponse } from "next/server";
import { getDashboardPool } from "@/lib/db/connection";
import { RowDataPacket } from "mysql2/promise";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, COOKIE_NAME, SESSION_MAX_AGE } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
    }

    const { username, password } = body as { username?: unknown; password?: unknown };

    if (!username || typeof username !== "string") {
      return NextResponse.json({ error: "Username is required" }, { status: 400 });
    }

    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    // Length limits to prevent abuse
    if (username.length > 100 || password.length > 128) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const pool = getDashboardPool();

    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, username, password_hash, email, role FROM dashboard_users WHERE username = ?",
      [username]
    );

    if (rows.length === 0) {
      // Constant-time: still hash to prevent timing oracle
      verifyPassword(password, "{SSHA512}" + "A".repeat(108));
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const user = rows[0];
    const valid = verifyPassword(password, user.password_hash);

    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Update last_login
    await pool.query(
      "UPDATE dashboard_users SET last_login = NOW() WHERE id = ?",
      [user.id]
    );

    // Set session cookie directly on response object
    const token = createSessionToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });

    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
