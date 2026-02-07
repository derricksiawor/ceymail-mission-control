import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import {
  configExists,
  saveConfig,
  generateSessionSecret,
  invalidateCache,
  type AppConfig,
} from "@/lib/config/config";
import { resetPools } from "@/lib/db/connection";

interface StepResult {
  step: string;
  status: "done" | "failed";
  detail: string;
}

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

    const {
      host,
      port,
      rootUser,
      rootPassword,
      ceymailUser,
      ceymailPassword,
    } = body as {
      host?: string;
      port?: number;
      rootUser?: string;
      rootPassword?: string;
      ceymailUser?: string;
      ceymailPassword?: string;
    };

    const dbRootPassword = (typeof rootPassword === "string") ? rootPassword : "";

    if (!ceymailPassword || typeof ceymailPassword !== "string") {
      return NextResponse.json(
        { error: "CeyMail user password is required" },
        { status: 400 }
      );
    }

    const dbHost = host && typeof host === "string" ? host.trim() : "localhost";
    const dbPort =
      typeof port === "number" && port > 0 && port < 65536 ? port : 3306;
    const dbRootUser =
      rootUser && typeof rootUser === "string" ? rootUser.trim() : "root";
    const dbCeymailUser =
      ceymailUser && typeof ceymailUser === "string"
        ? ceymailUser.trim()
        : "ceymail";

    const steps: StepResult[] = [];

    // Connect as root
    let connection: mysql.Connection;
    try {
      connection = await mysql.createConnection({
        host: dbHost,
        port: dbPort,
        user: dbRootUser,
        password: dbRootPassword,
        connectTimeout: 10000,
      });
      steps.push({
        step: "Connect to database",
        status: "done",
        detail: `Connected to ${dbHost}:${dbPort}`,
      });
    } catch (err: any) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to connect: ${err.message}`,
          steps: [
            {
              step: "Connect to database",
              status: "failed",
              detail: err.message,
            },
          ],
        },
        { status: 200 }
      );
    }

    try {
      // 1. Create ceymail database
      await connection.query(
        "CREATE DATABASE IF NOT EXISTS ceymail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
      );
      steps.push({
        step: "Create ceymail database",
        status: "done",
        detail: "Database created or already exists",
      });

      // 2. Create ceymail_dashboard database
      await connection.query(
        "CREATE DATABASE IF NOT EXISTS ceymail_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
      );
      steps.push({
        step: "Create ceymail_dashboard database",
        status: "done",
        detail: "Database created or already exists",
      });

      // 3. Create ceymail user + set password
      try {
        await connection.query(
          "CREATE USER IF NOT EXISTS ?@'localhost' IDENTIFIED BY ?",
          [dbCeymailUser, ceymailPassword]
        );
        // Update password in case user already existed with different password
        await connection.query("ALTER USER ?@'localhost' IDENTIFIED BY ?", [
          dbCeymailUser,
          ceymailPassword,
        ]);
        steps.push({
          step: "Create database user",
          status: "done",
          detail: `User '${dbCeymailUser}' created/updated`,
        });
      } catch (err: any) {
        steps.push({
          step: "Create database user",
          status: "failed",
          detail: err.message,
        });
        return NextResponse.json({ success: false, steps }, { status: 200 });
      }

      // 4. Grant privileges
      await connection.query(
        "GRANT ALL PRIVILEGES ON ceymail.* TO ?@'localhost'",
        [dbCeymailUser]
      );
      await connection.query(
        "GRANT ALL PRIVILEGES ON ceymail_dashboard.* TO ?@'localhost'",
        [dbCeymailUser]
      );
      await connection.query("FLUSH PRIVILEGES");
      steps.push({
        step: "Grant privileges",
        status: "done",
        detail: "Full privileges granted on both databases",
      });

      // 5. Create mail tables
      await connection.query("USE ceymail");

      await connection.query(`
        CREATE TABLE IF NOT EXISTS virtual_domains (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS virtual_users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          domain_id INT NOT NULL,
          email VARCHAR(255) NOT NULL UNIQUE,
          password VARCHAR(255) NOT NULL,
          quota BIGINT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (domain_id) REFERENCES virtual_domains(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS virtual_aliases (
          id INT AUTO_INCREMENT PRIMARY KEY,
          domain_id INT NOT NULL,
          source VARCHAR(255) NOT NULL,
          destination VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (domain_id) REFERENCES virtual_domains(id) ON DELETE CASCADE,
          UNIQUE KEY unique_alias (source, destination)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      steps.push({
        step: "Create mail tables",
        status: "done",
        detail: "virtual_domains, virtual_users, virtual_aliases",
      });

      // 6. Create dashboard tables
      await connection.query("USE ceymail_dashboard");

      await connection.query(`
        CREATE TABLE IF NOT EXISTS dashboard_users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(50) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          role ENUM('admin', 'viewer') DEFAULT 'admin',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          last_login TIMESTAMP NULL DEFAULT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT,
          action VARCHAR(100) NOT NULL,
          target VARCHAR(255),
          detail TEXT,
          ip_address VARCHAR(45),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS install_state (
          id INT AUTO_INCREMENT PRIMARY KEY,
          step_index INT NOT NULL DEFAULT 0,
          step_name VARCHAR(100) NOT NULL,
          status ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
          form_data JSON,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      steps.push({
        step: "Create dashboard tables",
        status: "done",
        detail: "dashboard_users, audit_logs, install_state",
      });

      // 7. Save config (with ceymail creds, NOT root creds)
      const sessionSecret = generateSessionSecret();
      const config: AppConfig = {
        version: 1,
        database: {
          host: dbHost,
          port: dbPort,
          user: dbCeymailUser,
          password: ceymailPassword,
          mailDatabase: "ceymail",
          dashboardDatabase: "ceymail_dashboard",
        },
        session: {
          secret: sessionSecret,
        },
        setupCompletedAt: null, // Set after admin creation
      };

      saveConfig(config);
      invalidateCache(); // Force re-read on next getConfig() call
      steps.push({
        step: "Save configuration",
        status: "done",
        detail: "Config saved to data/config.json",
      });

      // 8. Reset pools so app picks up new config
      await resetPools();

      // 9. Make session secret available in the current process.
      // We only set process.env + globalThis here (not .env.local) to avoid
      // triggering an HMR env reload that would destroy the wizard's React state.
      // The .env.local file is written later by the create-admin step.
      process.env.SESSION_SECRET = sessionSecret;
      (globalThis as Record<string, unknown>).__MC_SESSION_SECRET = sessionSecret;

      steps.push({
        step: "Finalize setup",
        status: "done",
        detail: "Connection pools reset, session secret active",
      });
    } finally {
      await connection.end();
    }

    const allDone = steps.every((s) => s.status === "done");

    return NextResponse.json(
      { success: allDone, steps },
      { status: allDone ? 200 : 500 }
    );
  } catch (error: any) {
    console.error("Provision error:", error);
    return NextResponse.json(
      { success: false, error: "Provisioning failed. Check database connectivity and permissions." },
      { status: 500 }
    );
  }
}
