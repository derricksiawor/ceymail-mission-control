import mysql from "mysql2/promise";
import { getConfig } from "@/lib/config/config";

// Connection pool for the mail database (ceymail)
let mailPool: mysql.Pool | null = null;

// Connection pool for the dashboard database (ceymail_dashboard)
let dashboardPool: mysql.Pool | null = null;

function getMailPool(): mysql.Pool {
  if (!mailPool) {
    const config = getConfig();
    if (!config) {
      throw new Error("Database not configured. Complete the setup wizard first.");
    }

    mailPool = mysql.createPool({
      host: config.database.host,
      user: config.database.user,
      password: config.database.password,
      database: config.database.mailDatabase,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 50,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return mailPool;
}

function getDashboardPool(): mysql.Pool {
  if (!dashboardPool) {
    const config = getConfig();
    if (!config) {
      throw new Error("Database not configured. Complete the setup wizard first.");
    }

    dashboardPool = mysql.createPool({
      host: config.database.host,
      user: config.database.user,
      password: config.database.password,
      database: config.database.dashboardDatabase,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 50,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return dashboardPool;
}

/**
 * Closes existing pools so the next call re-creates them with fresh config.
 * Called after the setup wizard saves a new config.
 */
async function resetPools(): Promise<void> {
  if (mailPool) {
    await mailPool.end();
    mailPool = null;
  }
  if (dashboardPool) {
    await dashboardPool.end();
    dashboardPool = null;
  }
}

export { getMailPool, getDashboardPool, resetPools };
