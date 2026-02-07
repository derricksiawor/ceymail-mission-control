import { NextResponse } from "next/server";
import { getConfig, configExists } from "@/lib/config/config";
import mysql from "mysql2/promise";

export type SetupState = "UNCONFIGURED" | "CONFIGURED" | "NEEDS_ADMIN" | "READY";

export async function GET() {
  try {
    // 1. No config at all -> UNCONFIGURED
    if (!configExists()) {
      return NextResponse.json({ state: "UNCONFIGURED" as SetupState });
    }

    const config = getConfig();
    if (!config) {
      return NextResponse.json({ state: "UNCONFIGURED" as SetupState });
    }

    // 2. Config exists – try connecting to the database
    let connection: mysql.Connection;
    try {
      connection = await mysql.createConnection({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: config.database.dashboardDatabase,
        connectTimeout: 5000,
      });
    } catch {
      // Config exists but DB unreachable – treat as configured but broken
      return NextResponse.json({ state: "CONFIGURED" as SetupState });
    }

    try {
      // 3. Check if dashboard_users table exists and has admins
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) as count FROM dashboard_users"
      );
      const adminCount = rows[0].count;

      if (adminCount === 0) {
        return NextResponse.json({ state: "NEEDS_ADMIN" as SetupState });
      }

      return NextResponse.json({ state: "READY" as SetupState });
    } catch {
      // Table doesn't exist yet – DB configured but not provisioned
      return NextResponse.json({ state: "CONFIGURED" as SetupState });
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("Welcome status check error:", error);
    return NextResponse.json({ state: "UNCONFIGURED" as SetupState });
  }
}
