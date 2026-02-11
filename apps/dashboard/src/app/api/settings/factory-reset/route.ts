import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import mysql from "mysql2/promise";
import { getConfig, invalidateCache } from "@/lib/config/config";
import { resetPools } from "@/lib/db/connection";
import { requireAdmin } from "@/lib/api/helpers";
import { COOKIE_NAME } from "@/lib/auth/session";

/**
 * POST /api/settings/factory-reset
 *
 * Nuclear reset: drops both databases, deletes config files, clears the
 * session cookie, and restarts the service. After restart the app has no
 * config and redirects to /welcome for a fresh setup.
 */
export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const config = getConfig();
  if (!config) {
    return NextResponse.json(
      { error: "No configuration found — already in first-run state" },
      { status: 400 }
    );
  }

  // Audit: log who triggered the reset before we destroy everything
  const userId = request.headers.get("x-user-id") || "unknown";
  const userName = request.headers.get("x-user-name") || "unknown";
  console.warn(
    `[FACTORY RESET] Triggered by user ${userName} (id=${userId}) — dropping databases and deleting config`
  );

  // 1. Close existing connection pools (non-fatal if this fails)
  try {
    await resetPools();
  } catch (err) {
    console.error("Factory reset — pool reset failed (continuing):", err);
  }

  // 2. Connect with the ceymail user and drop both databases
  let connection: mysql.Connection | null = null;
  try {
    connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      connectTimeout: 10000,
    });

    await connection.query("DROP DATABASE IF EXISTS ??", [config.database.mailDatabase]);
    await connection.query("DROP DATABASE IF EXISTS ??", [config.database.dashboardDatabase]);
  } catch (err) {
    console.error("Factory reset — database drop failed:", err);
    return NextResponse.json(
      { error: "Failed to drop databases" },
      { status: 500 }
    );
  } finally {
    if (connection) {
      await connection.end().catch(() => {});
    }
  }

  // 3. Delete config file — fatal if this fails (databases already dropped;
  //    a surviving config would leave the app in a broken half-reset state)
  const configPath = join(process.cwd(), "data", "config.json");
  try {
    if (existsSync(configPath)) unlinkSync(configPath);
  } catch (err) {
    console.error("Factory reset — CRITICAL: failed to delete config.json:", err);
    return NextResponse.json(
      { error: "Databases dropped but config file could not be removed. Manual intervention required." },
      { status: 500 }
    );
  }

  // 3b. Delete the deploy-backup copy of config.json so a subsequent
  //     deploy doesn't restore the old credentials into standalone/data/.
  const backupConfigPath = "/var/lib/ceymail-mc/config.json";
  try {
    if (existsSync(backupConfigPath)) unlinkSync(backupConfigPath);
  } catch (err) {
    console.warn("Factory reset — failed to delete backup config (non-fatal):", err);
  }

  // 4. Delete .env.local files (both local and systemd EnvironmentFile location)
  const envPaths = [
    join(process.cwd(), ".env.local"),
    "/var/lib/ceymail-mc/.env.local",
  ];
  for (const envPath of envPaths) {
    try {
      if (existsSync(envPath)) unlinkSync(envPath);
    } catch (err) {
      console.warn(`Factory reset — failed to delete ${envPath} (non-fatal):`, err);
    }
  }

  // 5. Invalidate in-memory config cache and clear runtime env vars
  //    so getConfig() won't fall back to DB_PASSWORD env var
  invalidateCache();
  delete process.env.DB_PASSWORD;
  delete process.env.DB_HOST;
  delete process.env.DB_PORT;
  delete process.env.DB_USER;
  delete process.env.SESSION_SECRET;
  delete (globalThis as Record<string, unknown>).__MC_SESSION_SECRET;

  // 6. Build response: clear session cookie and return success
  const response = NextResponse.json({ success: true });

  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  // 7. Schedule service restart so the process picks up the missing config
  if (process.env.NODE_ENV === "production") {
    setTimeout(() => {
      const child = spawn(
        "/usr/bin/sudo",
        ["/usr/bin/systemctl", "restart", "ceymail-dashboard"],
        { stdio: "ignore", detached: true }
      );
      child.unref();
    }, 1000);
  }

  return response;
}
