import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { configExists } from "@/lib/config/config";

export async function POST(request: NextRequest) {
  try {
    // Block if setup is already done
    if (configExists()) {
      return NextResponse.json(
        { error: "Setup already completed" },
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

    const { host, port, rootUser, rootPassword } = body as {
      host?: string;
      port?: number;
      rootUser?: string;
      rootPassword?: string;
    };

    if (!rootPassword || typeof rootPassword !== "string") {
      return NextResponse.json(
        { error: "Root password is required" },
        { status: 400 }
      );
    }

    const dbHost = (host && typeof host === "string") ? host.trim() : "localhost";
    const dbPort = (typeof port === "number" && port > 0 && port < 65536) ? port : 3306;
    const dbUser = (rootUser && typeof rootUser === "string") ? rootUser.trim() : "root";

    // Create a temporary connection to test credentials
    let connection: mysql.Connection;
    try {
      connection = await mysql.createConnection({
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: rootPassword,
        connectTimeout: 10000,
      });
    } catch (err: any) {
      const msg = err.code === "ER_ACCESS_DENIED_ERROR"
        ? "Access denied. Check your credentials."
        : err.code === "ECONNREFUSED"
        ? "Connection refused. Is MariaDB/MySQL running?"
        : err.code === "ENOTFOUND"
        ? "Host not found. Check the hostname."
        : "Connection failed. Check your database host and credentials.";

      return NextResponse.json({ success: false, error: msg }, { status: 200 });
    }

    try {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT VERSION() as version"
      );
      const version = rows[0]?.version || "Unknown";

      return NextResponse.json({ success: true, version });
    } finally {
      await connection.end();
    }
  } catch (error: any) {
    console.error("Test DB error:", error);
    return NextResponse.json(
      { success: false, error: "An unexpected error occurred while testing the connection." },
      { status: 500 }
    );
  }
}
