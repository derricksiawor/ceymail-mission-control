import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getDashboardPool } from "@/lib/db/connection";
import { RowDataPacket } from "mysql2/promise";

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Fetch fresh user data from DB (role may have changed)
    const pool = getDashboardPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id, username, email, role, created_at, last_login FROM dashboard_users WHERE id = ?",
      [session.userId]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "User no longer exists" }, { status: 401 });
    }

    return NextResponse.json({ user: rows[0] });
  } catch (error) {
    console.error("Auth check error:", error);
    return NextResponse.json({ error: "Authentication check failed" }, { status: 500 });
  }
}
