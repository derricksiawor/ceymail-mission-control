import { NextResponse } from "next/server";
import { getDashboardPool } from "@/lib/db/connection";
import type { RowDataPacket } from "mysql2/promise";

interface AuditLog extends RowDataPacket {
  id: number;
  user_id: number | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip_address: string | null;
  created_at: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const action = searchParams.get("action");

    // Validate limit and offset
    if (isNaN(limit) || limit < 1 || limit > 1000) {
      return NextResponse.json(
        { error: "Limit must be a number between 1 and 1000" },
        { status: 400 }
      );
    }

    if (isNaN(offset) || offset < 0 || offset > 100000) {
      return NextResponse.json(
        { error: "Offset must be a number between 0 and 100000" },
        { status: 400 }
      );
    }

    const pool = getDashboardPool();
    let query = "SELECT * FROM audit_logs";
    const params: (string | number)[] = [];

    // Add action filter if provided
    if (action) {
      query += " WHERE action = ?";
      params.push(action);
    }

    // Add ordering and pagination
    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const [rows] = await pool.query<AuditLog[]>(query, params);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch audit logs" },
      { status: 500 }
    );
  }
}
