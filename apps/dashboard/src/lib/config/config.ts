import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from "fs";
import { join } from "path";
import crypto from "crypto";

// ─── Schema ────────────────────────────────────────────────────────

export interface AppConfig {
  version: 1;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    mailDatabase: string;
    dashboardDatabase: string;
  };
  session: {
    secret: string;
  };
  setupCompletedAt: string | null;
  installCompletedAt: string | null;
}

// ─── Paths ─────────────────────────────────────────────────────────

const CONFIG_DIR = join(process.cwd(), "data");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

// ─── In-memory cache ───────────────────────────────────────────────

let cachedConfig: AppConfig | null = null;
let cachedMtime: number = 0;

// ─── Public API ────────────────────────────────────────────────────

/**
 * Reads the app config from data/config.json (with cache) or falls
 * back to environment variables for backward-compatible deployments.
 * Returns null when neither source is available (first-run state).
 */
export function getConfig(): AppConfig | null {
  // 1. Try config file
  if (existsSync(CONFIG_PATH)) {
    try {
      const stat = statSync(CONFIG_PATH);
      if (stat.mtimeMs !== cachedMtime || !cachedConfig) {
        const raw = readFileSync(CONFIG_PATH, "utf8");
        cachedConfig = JSON.parse(raw) as AppConfig;
        cachedMtime = stat.mtimeMs;
      }
      return cachedConfig;
    } catch {
      // Corrupted file – fall through to env vars
    }
  }

  // 2. Fallback: environment variables (Docker / legacy .env deploys)
  const dbPassword = process.env.DB_PASSWORD;
  if (dbPassword) {
    return {
      version: 1,
      database: {
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT || "3306", 10),
        user: process.env.DB_USER || "ceymail",
        password: dbPassword,
        mailDatabase: "ceymail",
        dashboardDatabase: "ceymail_dashboard",
      },
      session: {
        secret: process.env.SESSION_SECRET || dbPassword,
      },
      setupCompletedAt: null,
      installCompletedAt: null,
    };
  }

  return null;
}

/**
 * Persists config to data/config.json with 0600 permissions.
 */
export function saveConfig(config: AppConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  // Atomic write: write to temp file then rename to avoid partial reads
  const tmpPath = CONFIG_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(tmpPath, CONFIG_PATH);
  // Use actual file mtime for cache coherence
  const stat = statSync(CONFIG_PATH);
  cachedConfig = config;
  cachedMtime = stat.mtimeMs;
}

/**
 * Returns true when the app has *some* database configuration
 * (either a config file or env vars).
 */
export function configExists(): boolean {
  return existsSync(CONFIG_PATH) || !!process.env.DB_PASSWORD;
}

/**
 * Generates a cryptographically random 64-character hex session secret.
 */
export function generateSessionSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Clears the in-memory cache so the next getConfig() re-reads disk.
 */
export function invalidateCache(): void {
  cachedConfig = null;
  cachedMtime = 0;
}

/**
 * Writes SESSION_SECRET to .env.local so Next.js makes it available
 * to all runtimes (including Edge middleware) on next startup.
 * Also sets process.env and globalThis for immediate use in the
 * current process.
 *
 * In dev mode, Next.js Edge Runtime bundles process.env at compile time.
 * Writing .env.local triggers an env reload but does NOT recompile the
 * middleware — so the Edge Runtime still sees the OLD (empty) value.
 * To work around this, we "touch" the middleware source file to force
 * HMR to recompile it with the new env vars.
 */
export function persistSessionSecret(secret: string): void {
  // Immediate: same-process access for Node.js API routes + Edge emulation
  process.env.SESSION_SECRET = secret;
  (globalThis as Record<string, unknown>).__MC_SESSION_SECRET = secret;

  // Persistent: write to both local .env.local and the systemd EnvironmentFile
  // location so the Edge middleware has SESSION_SECRET after a service restart.
  const envLine = `SESSION_SECRET=${secret}`;
  const envPaths = [
    join(process.cwd(), ".env.local"),       // Local (dev mode / Next.js auto-load)
    "/var/lib/ceymail-mc/.env.local",        // systemd EnvironmentFile (production)
  ];

  for (const envPath of envPaths) {
    try {
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, "utf8");
        // Skip write if the file already contains the exact same secret
        if (content.includes(envLine)) continue;

        let updated: string;
        if (/^SESSION_SECRET=.*/m.test(content)) {
          updated = content.replace(/^SESSION_SECRET=.*/m, envLine);
        } else {
          updated = content.trimEnd() + "\n" + envLine + "\n";
        }
        writeFileSync(envPath, updated, { encoding: "utf8", mode: 0o600 });
      } else {
        writeFileSync(envPath, envLine + "\n", { encoding: "utf8", mode: 0o600 });
      }
    } catch {
      // Non-fatal: the path may not be writable (e.g. /var/lib/... in dev mode)
    }
  }

  // Touch the middleware source to force an HMR recompile in dev mode.
  // The Edge Runtime bundles env vars at compile time, so without this
  // the middleware would keep using the old (empty) SESSION_SECRET.
  if (process.env.NODE_ENV !== "production") {
    try {
      const mwPath = join(process.cwd(), "src", "middleware.ts");
      if (existsSync(mwPath)) {
        const src = readFileSync(mwPath, "utf8");
        const marker = /\/\/ edge-env-refresh.*$/m;
        const stamp = `// edge-env-refresh ${Date.now()}`;
        const updated = marker.test(src)
          ? src.replace(marker, stamp)
          : src.replace(
              /^(const COOKIE_NAME = .*)$/m,
              `$1 ${stamp}`
            );
        if (updated !== src) {
          writeFileSync(mwPath, updated, "utf8");
        }
      }
    } catch {
      // Non-fatal: middleware will pick up the secret on next manual save
    }
  }
}
