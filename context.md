# CeyMail Mission Control — Full Project Context

## Production Server Access

- **Server IP**: `159.203.78.131` (DigitalOcean droplet)
- **SSH**: `ssh root@159.203.78.131`
- **OS**: Ubuntu (22.04 or 24.04 LTS)
- **Dashboard URL**: https://control.ceymail.com
- **Webmail URL**: https://ceymail.com/webmail
- **Mail domain**: `ceymail.com`
- **Dashboard subdomain**: `control.ceymail.com`

### How to Deploy to Production

```bash
ssh root@159.203.78.131
cd /opt/mission-control
bash deploy/scripts/deploy-dashboard.sh
```

The deploy script automatically:
1. Pulls latest code from `main` branch
2. Validates and installs sudoers rules
3. Installs helper scripts (`ceymail-roundcube-db`, `ceymail-nginx-webmail`, `ceymail-apache2-webmail`, `ceymail-backup`)
4. Installs polkit rules
5. Installs/reloads systemd service
6. Backs up live `config.json` and `.env.local` before build
7. Runs `npm install` and `npm run build`
8. Copies static assets into standalone output
9. Restores config files into fresh standalone build
10. Sets ownership to `ceymail-mc` user
11. Restarts `ceymail-dashboard` systemd service
12. Verifies the service is running

### Production File Locations

| Path | Purpose |
|------|---------|
| `/opt/mission-control/` | Git repository (cloned from GitHub) |
| `/opt/mission-control/apps/dashboard/.next/standalone/` | Running Next.js build |
| `/opt/mission-control/apps/dashboard/.next/standalone/data/config.json` | Runtime config (DB creds, session secret) |
| `/var/lib/ceymail-mc/` | Persistent data directory (config backups, .env.local backup) |
| `/var/lib/ceymail-mc/config.json` | Backup copy of config.json (survives builds) |
| `/var/lib/ceymail-mc/.env.local` | Backup copy of .env.local (SESSION_SECRET for Edge middleware) |
| `/etc/nginx/sites-available/control.ceymail.com` | Dashboard Nginx reverse proxy config |
| `/etc/nginx/sites-available/roundcube-webmail` | Webmail Nginx server block |
| `/etc/nginx/snippets/roundcube-webmail.conf` | Roundcube location snippet (included in server blocks) |
| `/etc/sudoers.d/ceymail-mc` | Sudo rules for ceymail-mc user |
| `/etc/systemd/system/ceymail-dashboard.service` | Dashboard systemd unit |
| `/usr/share/polkit-1/rules.d/45-ceymail-mc.rules` | Polkit rules for service management |
| `/etc/letsencrypt/live/control.ceymail.com/` | SSL cert for dashboard |
| `/etc/letsencrypt/live/ceymail.com/` | SSL cert for mail domain + webmail |
| `/etc/postfix/` | Postfix configuration |
| `/etc/dovecot/` | Dovecot configuration |
| `/etc/opendkim/` | OpenDKIM configuration and keys |
| `/etc/roundcube/config.inc.php` | Roundcube webmail config |
| `/usr/local/bin/ceymail-roundcube-db` | Roundcube DB helper script |
| `/usr/local/bin/ceymail-nginx-webmail` | Nginx webmail config helper |
| `/usr/local/bin/ceymail-apache2-webmail` | Apache webmail config helper |
| `/usr/local/bin/ceymail-backup` | Restricted backup archive creator (path-validated tar wrapper) |
| `/var/backups/ceymail/` | Backup archive storage directory |

### Service Management

```bash
# Dashboard
systemctl status ceymail-dashboard
systemctl restart ceymail-dashboard
journalctl -u ceymail-dashboard -f        # Live logs

# Mail services
systemctl status postfix dovecot opendkim spamassassin nginx

# Mail queue
postqueue -p

# SSL
certbot certificates
```

### systemd Service Details

- **Unit**: `ceymail-dashboard.service`
- **User**: `ceymail-mc` (system user, nologin shell)
- **WorkingDirectory**: `/opt/mission-control/apps/dashboard/.next/standalone`
- **EnvironmentFile**: `/var/lib/ceymail-mc/.env.local` (contains SESSION_SECRET)
- **Environment**: `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=127.0.0.1`
- **ExecStart**: `/usr/bin/node server.js`
- **Security hardening**: ProtectHome, PrivateTmp, PrivateDevices, ProtectKernelTunables/Modules/ControlGroups
- **ReadWritePaths**: standalone/data (config.json), /var/lib/ceymail-mc (backups)

---

## Architecture Overview

```
ceymail-mission-control/
├── setup.sh                         # One-command bootstrap (new)
├── DEPLOY.md                        # Deployment documentation
├── CLAUDE.md                        # Project conventions (for AI assistants)
├── apps/dashboard/                  # Next.js 15 frontend + API routes
│   ├── src/app/                     # Pages + API routes
│   │   ├── (welcome)/               # First-run setup wizard (no auth)
│   │   ├── (auth)/                  # Login page (no auth)
│   │   ├── (dashboard)/             # Main dashboard (auth required)
│   │   └── api/                     # API routes
│   │       ├── welcome/             # Setup wizard APIs (no auth)
│   │       │   ├── provision/       # Database provisioning
│   │       │   ├── create-admin/    # Admin account creation
│   │       │   └── login/           # Authentication
│   │       ├── webmail/             # Roundcube setup API
│   │       ├── dkim/                # DKIM key management
│   │       ├── settings/            # Settings + factory reset
│   │       └── ...                  # Domains, users, aliases, services, queue, logs
│   ├── src/components/              # UI components
│   │   ├── welcome/                 # Setup wizard components
│   │   └── install/                 # Install wizard components
│   ├── src/lib/                     # Shared libraries
│   │   ├── config/config.ts         # Runtime config reader/writer
│   │   ├── db/connection.ts         # MySQL2 connection pools
│   │   ├── auth/session.ts          # HMAC-SHA256 session management
│   │   ├── auth/password.ts         # SSHA512 password hashing
│   │   └── api/helpers.ts           # API route helpers (requireAdmin)
│   ├── src/middleware.ts            # Edge middleware (auth, rate limit, CORS)
│   └── data/config.json            # Runtime config (git-ignored)
├── deploy/
│   ├── scripts/
│   │   ├── deploy-dashboard.sh      # Build + deploy lifecycle
│   │   ├── ceymail-nginx-webmail.sh # Nginx webmail config helper
│   │   ├── ceymail-apache2-webmail.sh # Apache webmail config helper (new)
│   │   └── ceymail-roundcube-db.sh  # Roundcube database helper
│   ├── sudoers/ceymail-mc           # Sudoers rules
│   ├── systemd/ceymail-dashboard.service
│   └── polkit/45-ceymail-mc.rules
├── crates/                          # Rust backend (not yet active in production)
└── proto/                           # Protobuf definitions
```

## Tech Stack

- **Frontend**: Next.js 15.1 / React 19 / TypeScript 5.7 / Tailwind CSS 4.0
- **UI**: Radix UI, TanStack React Query 5, Zustand 5, Framer Motion, Recharts, Lucide icons
- **Database**: MariaDB via mysql2 (two databases: `ceymail` for mail, `ceymail_dashboard` for app)
- **Auth**: Custom HMAC-SHA256 session tokens (not JWT), httpOnly cookies, 8-hour expiry
- **Passwords**: SSHA512 + 16-byte random salt (Dovecot-compatible)
- **CSS tokens**: `mc-*` custom color tokens (bg-mc-surface, text-mc-text, etc.)
- **Font**: Poppins

## Databases

| Database | Tables | Purpose |
|----------|--------|---------|
| `ceymail` | `virtual_domains`, `virtual_users`, `virtual_aliases` | Postfix/Dovecot mail data |
| `ceymail_dashboard` | `dashboard_users`, `audit_logs`, `install_state`, `health_snapshots` | Dashboard app data |
| `roundcube` | (Roundcube schema) | Roundcube webmail data |

- DB user: `ceymail` (created by provision wizard, stored in config.json)
- Roundcube DB user: `roundcube` (isolated, created by webmail setup)
- Credentials in `data/config.json` (mode 0o600)

## Security Model

- **ceymail-mc** system user runs the dashboard (nologin shell)
- Sudoers file enumerates every allowed command (no wildcards on dangerous ops)
- Polkit rules whitelist specific systemd units and verbs
- Helper scripts validate all inputs (domain regex, path checks)
- Config files written with mode 0600/0640
- Root DB password never stored (used transiently during setup only)
- All SQL uses prepared statements
- Rate limiting on all mutation endpoints
- CSP, HSTS, X-Frame-Options: DENY on all responses
- Nginx reverse proxy with rate limiting zones (general, API, login)

## User Flows

### First-Time Setup
1. Run `setup.sh` (or manual deploy) -> dashboard starts on port 3000
2. Open dashboard URL -> redirected to `/welcome`
3. Provision step: enter MariaDB root creds -> creates databases, tables, ceymail user, saves config
4. Create admin: username/password -> dashboard admin account
5. Login -> redirected to dashboard home

### Install Mail Services
1. Dashboard -> Settings -> Install Mail Services (or `/install`)
2. Install wizard steps: packages, configuration, DKIM, SSL, webmail, summary
3. Each step runs via API routes that execute sudo commands
4. Summary shows DNS records to configure

### Factory Reset
1. Dashboard -> Settings -> About -> Danger Zone -> Factory Reset
2. Drops both databases, deletes config.json and .env.local, clears session cookie
3. Restarts ceymail-dashboard service
4. App returns to `/welcome` wizard

---

## Recent Work (Current Session)

### Single-Command Bootstrap Plan

**Approved plan**: `/Users/Derrick/.claude/plans/ethereal-drifting-meteor.md`

Goal: Replace 15-step manual deployment with one command like Mail-in-a-Box:
```bash
wget -qO- https://raw.githubusercontent.com/derricksiawor/ceymail-mission-control/main/setup.sh | sudo bash
```

### Files Created

1. **`setup.sh`** (project root, ~743 lines)
   - Single-command bootstrap script
   - Asks 3 questions: mail domain, dashboard subdomain, certbot email
   - Auto-detects web server (Apache/Nginx), installs deps, builds dashboard, configures reverse proxy, obtains SSL
   - Idempotent with config saved to `/etc/ceymail.conf`
   - Functions: `preflight()`, `detect_web_server()`, `install_dependencies()`, `setup_repo()`, `deploy_dashboard()`, `generate_nginx_config()`, `generate_apache_config()`, `setup_ssl()`, `print_summary()`

2. **`deploy/scripts/ceymail-apache2-webmail.sh`** (~96 lines)
   - Apache mirror of `ceymail-nginx-webmail.sh`
   - Interface: `add-include DOMAIN`, `remove-include`, `cleanup-legacy`
   - Uses `a2enconf/a2disconf` with `apache2ctl configtest` validation
   - Automatic rollback on failure

### Files Modified

3. **`deploy/scripts/deploy-dashboard.sh`** (lines 94-96 added)
   - Installs `ceymail-apache2-webmail` helper alongside the Nginx one

4. **`deploy/sudoers/ceymail-mc`** (lines 220-222 added)
   - Sudoers entries for Apache webmail helper commands

5. **`DEPLOY.md`** (complete rewrite)
   - One-liner quick start, web server support table, concise reference sections
   - Old 15-step manual preserved in collapsible `<details>`

6. **`apps/dashboard/src/components/install/steps/summary.tsx`** (line 99)
   - DMARC changed from `p=quarantine` to `p=none`
   - Added upgrade guidance in Next Steps
   - Already deployed to production (commit `1280867`)

### Key Design Decisions

- **Web server detection**: Apache if running alone; Nginx preferred if both; fresh Nginx install if neither
- **MariaDB**: unix_socket auth (no root password on Ubuntu)
- **SSL chicken-and-egg**: Auto-detects DNS; HTTP-only fallback if DNS not ready; re-run enables SSL
- **Idempotent**: `/etc/ceymail.conf` stores inputs for re-runs

## Task Status

- #55 [completed] Create setup.sh bootstrap script
- #56 [completed] Create ceymail-apache2-webmail.sh helper
- #57 [completed] Update deploy-dashboard.sh and sudoers for Apache helper
- #58 [completed] Update DEPLOY.md to one-liner quick start
- #41 [completed] Harden install wizard for 2026 mail standards
- #52 [completed] Fix SSL cert and HTTPS redirect for webmail on ceymail.com
- #75 [completed] Fix logs page to show mail server logs (was showing empty audit_logs table)
- #76 [completed] Fix backup creation failure (removed unsupported `--no-dereference` tar flag)
- #78 [completed] Playwright browser testing against production (logs + backups verified working)
- #79 [completed] Update context.md with all changes

## Audit Round 1 — Completed

6 parallel audit agents found ~40 issues. All CRITICAL/HIGH/MEDIUM/LOW fixes applied:

### CRITICAL (3 fixed)
1. `read` in setup.sh fails when piped via `wget | sudo bash` — added `< /dev/tty` to all `read` calls
2. `--redirect` flag invalid with `certbot certonly` — removed from both certbot calls
3. `ufw --force reset` destroys custom firewall rules on re-run — removed reset, idempotent allow only

### HIGH (5 fixed)
1. `source /etc/ceymail.conf` allows shell injection — replaced with safe key=value parsing
2. `source /etc/os-release` may clobber variables — replaced with `grep` parsing
3. No domain validation in `gather_inputs()` — added RFC regex validation
4. Nginx SSL config written before verifying cert exists — added cert existence check before full config
5. `a2enmod` failures silenced — now fails with error message

### MEDIUM (7 fixed)
1. certbot stderr suppressed — now shows last 5 lines of output
2. `dig +short` may return CNAME — now filters for IPv4 addresses only
3. Node.js upgrade threshold was `< 20` — changed to `< 22`
4. Apache config missing CSP header — added matching CSP from Nginx config
5. `npm install --production=false` deprecated — changed to `--include=dev`
6. Predictable temp file in deploy-dashboard.sh — changed to `mktemp`
7. DEPLOY.md wording "skip the prompts" inaccurate — changed to "pre-fill previous values as defaults"

### LOW (3 fixed)
1. Removes default Nginx site on every re-run — now only removes if it's the stock default
2. Missing `systemctl reload apache2` in sudoers — added
3. Missing `systemctl disable` entries in sudoers — added all disable entries

### Other fixes
- Scoped `Defaults env_keep` to ceymail-mc only (was global)
- Added clarifying comment for duplicate chmod modes in sudoers
- Added `ceymail-dashboard.service` + `enable`/`disable` verbs to polkit rules
- Apache helper: symlinks `/etc/roundcube/apache.conf` into `conf-available` when needed
- deploy-dashboard.sh: added `pipefail`, build rollback on failure

## Audit Round 2 — Completed

5 parallel audit agents found ~22 issues. All fixes applied:

### setup.sh fixes (11)
1. `hostname -I` fallback could return private/IPv6 — now uses `ip route get 8.8.8.8` with IPv4 validation
2. `/etc/hosts` grep substring match — changed to `-qw` word boundary
3. Web server auto-detection overwrites saved preference on re-run — now respects saved WEB_SERVER from config
4. `apt-get upgrade` runs on every re-run — now only on first run (tracked via config file existence)
5. NodeSource setup failure swallowed by `&>/dev/null` — now shows last 5 lines and fatals on failure
6. `git pull` can fail on dirty working tree — changed to `git fetch` + `git reset --hard`
7. HTTP-only Nginx config lacked rate limiting/security headers — added full rate limiting zones and security headers
8. HTTP-only Apache config lacked security headers — added X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
9. Nginx `http2` deprecated syntax on 1.25.1+ — changed from `listen 443 ssl http2` to `listen 443 ssl` + `http2 on`
10. `/_next/static/` location block suppressed parent security headers — added all security headers (Nginx add_header inheritance)
11. `nginx -t` / `apache2ctl configtest` failures silently swallowed — now shows output and warns on failure

### deploy-dashboard.sh fixes (5)
1. `cp -r public` fails if `public/` doesn't exist — added directory existence guard
2. Rollback used `cp -a` (slow, doubles disk) — changed to `mv`
3. Stale rollback dirs from interrupted deploys — auto-cleanup of dirs older than 60 minutes
4. Missing helper script existence checks — added validation loop with error on missing files
5. Build success not verified — added check for `standalone/server.js` after build
6. `git pull` dirty working tree — changed to `git fetch` + `git reset --hard`

### sudoers fixes (2)
1. `postsuper -d *` wildcard — added explicit `postsuper -d ALL` entry and documenting comments
2. `opendkim-genkey *` wildcard — added documenting comments explaining API validation layer

### Helper script fixes (1)
1. Apache helper suppressed configtest stderr — now shows output on failure

## Audit Round 3 — Completed

4 parallel audit agents found 4 issues. All fixed:

1. **HIGH**: Missing CSP header on `/_next/static/` Nginx location block — added matching CSP header
2. **MEDIUM**: CERTBOT_EMAIL not validated — added email format regex validation
3. **MEDIUM**: DEPLOY.md invalid `ufw allow` syntax (multiple ports in one call) — split into separate commands
4. **LOW**: deploy-dashboard.sh missing `-u` nounset flag — added `set -euo pipefail` and fixed `${1:-}` for safety

## Audit Round 4 — Completed

4 parallel audit agents found 4 issues. All fixed:

1. **HIGH**: `npm install` failure in deploy-dashboard.sh exits without rollback — wrapped in error handler with rollback restoration
2. **HIGH**: Dual CSP headers from Nginx and Next.js conflict (browser enforces intersection) — added `proxy_hide_header Content-Security-Policy` (Nginx) and `Header unset Content-Security-Policy` (Apache) so the reverse proxy is the sole CSP source
3. **MEDIUM**: `git reset --hard origin/main --quiet` flag ordering — `--quiet` parsed as pathspec; fixed to `git reset --quiet --hard origin/main`
4. **MEDIUM**: `/etc/hosts` accumulates stale `127.0.1.1` entries on re-runs with different domains — now removes old entry before adding new one

## Audit Round 5 — Completed

4 parallel audit agents found 4 issues. All fixed:

1. **CRITICAL**: `http2 on;` directive requires Nginx 1.25.1+ but Ubuntu 22.04 ships 1.18.0 and 24.04 ships 1.24.0 — reverted to `listen 443 ssl http2;` syntax
2. **HIGH**: Duplicate `limit_req_zone` zones when dashboard domain changes between re-runs causes Nginx failure — added stale CeyMail config cleanup before generating new configs
3. **MEDIUM**: Stale Apache VirtualHost not disabled when domain changes — added stale config cleanup for Apache too
4. **MEDIUM**: Added `ProtectSystem=strict` to systemd service, but this blocks ALL sudo write operations since child processes inherit the read-only mount namespace — REVERTED and documented why it cannot be used

## Audit Round 6 — Completed

4 parallel audit agents. Results:
- Quality Auditor: 1 CRITICAL (ProtectSystem=strict blocks sudo writes) — already reverted
- Code Reviewer: 1 CRITICAL (same ProtectSystem issue) — already fixed
- Security Auditor: 1 LOW (Apache lacks rate limiting — no built-in equivalent, app-level limiter exists)
- Debug Auditor: 1 CRITICAL (same ProtectSystem issue) — already fixed

After fixing: all agents confirmed 0 remaining issues.

## Audit Round 7 — FINAL — 0 Issues

4 parallel audit agents. ALL FOUR returned **0 ISSUES FOUND**.

Total issues fixed across 7 rounds: ~55+ issues (3 CRITICAL, 8+ HIGH, 15+ MEDIUM, 5+ LOW, plus many correctness fixes).

## Production Deployment — Fully Operational

The one-line bootstrap script has been tested end-to-end on production. Full deployment verified:

```bash
wget -qO- https://raw.githubusercontent.com/derricksiawor/ceymail-mission-control/main/setup.sh | sudo bash
```

### Verified Working (via Playwright browser testing against production)

- All 8 services running: Postfix, Dovecot, OpenDKIM, SpamAssassin, Nginx, Unbound, rsyslog, MariaDB
- Email sending and receiving functional (DKIM/SPF/DMARC passing)
- Dashboard health metrics (CPU, memory, disk, mail queue, service health)
- Logs page displaying live mail server logs with service filtering
- Backup creation and management (config, database, DKIM, mailboxes)
- Domain, user, and alias management
- DKIM key management
- Service start/stop/restart controls
- Mail queue management

### Bug Fixes Applied (commit `1f9118d`)

**1. Logs page showing empty state ("No log entries")**

- **Root cause**: `logs/page.tsx` was wired to `useLogs()` hook which fetched from the `audit_logs` database table. This table was never populated — no INSERT statements exist anywhere in the codebase for it.
- **Fix**: Rewired the logs page to use `useMailLogs()` hook, which reads live mail server logs from `/var/log/mail.log` via the `/api/logs/mail` endpoint.
- **Changes**: Replaced `useLogs`/`LogEntry` imports with `useMailLogs`/`MailLogEntry`, changed "Actions" filter to "Services" filter (derived from `log.source` field), updated subtitle text, updated all related handler names.
- **File**: `apps/dashboard/src/app/(dashboard)/logs/page.tsx`

**2. Backup creation failing ("Failed to create backup archive")**

- **Root cause**: Found exact error in `journalctl -u ceymail-dashboard`: `/usr/bin/tar: unrecognized option '--no-dereference'`. GNU tar 1.35 on Ubuntu 24.04 does not support the `--no-dereference` flag.
- **Fix**: Removed `--no-dereference` from the tar command. GNU tar's default behavior already stores symlinks as symlinks (does NOT follow them), so this flag was redundant. Added comments documenting this default behavior.
- **File**: `deploy/scripts/ceymail-backup.sh` (line 71)

### Previous Backend Hardening (commit `9635cd1`)

Major hardening of all backend API routes:

- **Logs API** (`/api/logs/mail`): Efficient tail-reading of `/var/log/mail.log` (128KB buffer, no full-file load), dual syslog format parsing (ISO 8601 + BSD), permission error distinction (403 vs 500)
- **Stats API** (`/api/stats`): Auto-collecting health snapshots into DB (promise-based lock, 60s interval), 7-day pruning, cached system totals, all-zero detection to skip broken collections
- **Backup API** (`/api/backup`): Full backup pipeline — DB dump via mysqldump (sanitized env, no secret leakage), tar via restricted sudo wrapper script, temp file cleanup in finally blocks, concurrent backup prevention (409), defense-in-depth filename validation on DELETE
- **Backup shell wrapper** (`ceymail-backup.sh`): Path allowlist validation, output path validation, symlink-safe tar defaults
- **DNS rollback**: Added DNS configuration rollback on failure during install wizard

## Known Issues / Ongoing

- **Email spam**: Emails from ceymail.com land in Gmail spam despite SPF/DKIM/DMARC passing. Root cause: new IP reputation on DigitalOcean + UCEPROTECT Level 3 listing (entire ASN). Requires domain warming over 2-4 weeks.
- **Port 25**: DigitalOcean blocks port 25 by default on new accounts. Must request unblocking via support ticket. Current production server has port 25 open.
- **DMARC progression**: Start with `p=none`, upgrade to `p=quarantine` after 30 days of positive sending, then `p=reject`.

## Local Development

```bash
cd apps/dashboard
npm run dev              # Dev server on :3000 with Turbopack
npm run build            # Production build (standalone output)
npx tsc --noEmit         # Type check
```

The local dev environment connects to MariaDB and reads config from `data/config.json`. Edge middleware reads `SESSION_SECRET` from `.env.local`.
