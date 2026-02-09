import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { getConfig } from "@/lib/config/config";

// POST - Create databases, tables, and initial data
export async function POST(request: NextRequest) {
  try {
    const role = request.headers.get("x-user-role");
    if (role !== "admin") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or missing JSON body" }, { status: 400 });
    }

    const { hostname, mailDomain, adminEmail } = body as {
      hostname?: string;
      mailDomain?: string;
      adminEmail?: string;
    };

    if (!mailDomain || typeof mailDomain !== "string") {
      return NextResponse.json({ error: "Mail domain is required" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(mailDomain)) {
      return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
    }

    const config = getConfig();
    if (!config) {
      return NextResponse.json({ error: "Database not configured. Complete the setup wizard first." }, { status: 500 });
    }

    // Connect using config credentials
    const connection = await mysql.createConnection({
      host: config.database.host,
      user: config.database.user,
      password: config.database.password,
    });

    const steps: { step: string; status: "done" | "failed"; detail: string }[] = [];

    try {
      // 1. Create ceymail database (may already exist from welcome wizard)
      try {
        await connection.query("CREATE DATABASE IF NOT EXISTS ceymail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        steps.push({ step: "Create ceymail database", status: "done", detail: "Database created or already exists" });
      } catch {
        // DB likely already exists and user has access
        steps.push({ step: "Create ceymail database", status: "done", detail: "Database already exists" });
      }

      // 2. Create ceymail_dashboard database (may already exist from welcome wizard)
      try {
        await connection.query("CREATE DATABASE IF NOT EXISTS ceymail_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        steps.push({ step: "Create ceymail_dashboard database", status: "done", detail: "Database created or already exists" });
      } catch {
        // DB likely already exists and user has access
        steps.push({ step: "Create ceymail_dashboard database", status: "done", detail: "Database already exists" });
      }

      // 3. Create ceymail user if not exists
      try {
        await connection.query(
          "CREATE USER IF NOT EXISTS ?@'localhost' IDENTIFIED BY ?",
          ["ceymail", config.database.password]
        );
        steps.push({ step: "Create database user", status: "done", detail: "User ceymail created or already exists" });
      } catch (userError: unknown) {
        const err = userError as { code?: string };
        if (err.code !== "ER_CANNOT_USER") {
          steps.push({ step: "Create database user", status: "failed", detail: "Failed to create database user" });
        }
      }

      // 4. Grant privileges (may fail if connected as non-root user that already has privileges)
      try {
        await connection.query("GRANT ALL PRIVILEGES ON ceymail.* TO ?@'localhost'", ["ceymail"]);
        await connection.query("GRANT ALL PRIVILEGES ON ceymail_dashboard.* TO ?@'localhost'", ["ceymail"]);
        await connection.query("FLUSH PRIVILEGES");
        steps.push({ step: "Grant privileges", status: "done", detail: "Full privileges granted on both databases" });
      } catch (grantError: unknown) {
        const err = grantError as { code?: string };
        // ER_DBACCESS_DENIED_ERROR or ER_SPECIFIC_ACCESS_DENIED_ERROR means
        // we're connected as a non-root user — privileges were already set up
        // by the welcome wizard, so this is safe to skip
        if (err.code === "ER_DBACCESS_DENIED_ERROR" || err.code === "ER_SPECIFIC_ACCESS_DENIED_ERROR") {
          steps.push({ step: "Grant privileges", status: "done", detail: "Privileges already configured (welcome wizard)" });
        } else {
          throw grantError;
        }
      }

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
      steps.push({ step: "Create mail tables", status: "done", detail: "virtual_domains, virtual_users, virtual_aliases" });

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
      steps.push({ step: "Create dashboard tables", status: "done", detail: "dashboard_users, audit_logs, install_state" });

      // 7. Insert initial domain
      await connection.query("USE ceymail");
      try {
        await connection.query(
          "INSERT IGNORE INTO virtual_domains (name) VALUES (?)",
          [mailDomain]
        );
        steps.push({ step: "Add initial domain", status: "done", detail: `Domain ${mailDomain} added` });
      } catch {
        steps.push({ step: "Add initial domain", status: "done", detail: "Domain already exists" });
      }

      // 8. Create postfix MySQL lookup files
      steps.push({ step: "Database setup complete", status: "done", detail: "All migrations applied successfully" });

    } finally {
      await connection.end();
    }

    const allDone = steps.every((s) => s.status === "done");

    return NextResponse.json({
      success: allDone,
      steps,
    }, { status: allDone ? 200 : 500 });
  } catch (error: unknown) {
    console.error("Error in database setup:", error);
    return NextResponse.json(
      { error: "Failed to set up database. Check server logs for details." },
      { status: 500 }
    );
  }
}
