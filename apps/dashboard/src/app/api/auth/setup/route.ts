import { NextRequest, NextResponse } from "next/server";
import { getDashboardPool } from "@/lib/db/connection";
import { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { hashPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";

export async function GET() {
  try {
    const pool = getDashboardPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM dashboard_users"
    );
    const needsSetup = rows[0].count === 0;
    return NextResponse.json({ needsSetup });
  } catch (error) {
    console.error("Setup check error:", error);
    return NextResponse.json({ error: "Setup check failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const pool = getDashboardPool();

    // Only allow setup when no users exist
    const [existing] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) as count FROM dashboard_users"
    );

    if (existing[0].count > 0) {
      return NextResponse.json(
        { error: "Setup already completed. An admin account already exists." },
        { status: 403 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
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

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
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

    // Auto-login after setup
    await setSessionCookie({
      userId: result.insertId,
      username: username,
      role: "admin",
    });

    return NextResponse.json(
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
  } catch (error: any) {
    console.error("Setup error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "An account with this username already exists" },
        { status: 409 }
      );
    }

    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
