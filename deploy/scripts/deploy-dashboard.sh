#!/bin/bash
set -euo pipefail

# CeyMail Mission Control - Dashboard Deploy Script
# Handles: git pull, sudoers, systemd, npm install, build, config restore, restart
# Usage: deploy-dashboard [--initial]
#   --initial: First-time setup (creates user, directories, nginx config)

REPO_DIR="/opt/mission-control"
DASHBOARD_DIR="$REPO_DIR/apps/dashboard"
STANDALONE_DIR="$DASHBOARD_DIR/.next/standalone"
DATA_DIR="/var/lib/ceymail-mc"
SERVICE_USER="ceymail-mc"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $1"; }
err() { echo -e "${RED}[deploy]${NC} $1" >&2; }

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    err "This script must be run as root"
    exit 1
fi

INITIAL=false
if [ "${1:-}" = "--initial" ]; then
    INITIAL=true
fi

# ── Initial setup (first-time only) ──
if [ "$INITIAL" = true ]; then
    log "Running initial setup..."

    # Create service user if not exists
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd -r -m -d "$DATA_DIR" -s /usr/sbin/nologin "$SERVICE_USER"
        log "Created service user: $SERVICE_USER"
    else
        log "Service user $SERVICE_USER already exists"
    fi

    # Add to adm group so the dashboard can read /var/log/mail.log (syslog:adm 640)
    if getent group adm &>/dev/null; then
        usermod -aG adm "$SERVICE_USER" 2>/dev/null || true
    fi

    # Create data directory
    mkdir -p "$DATA_DIR/backups"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

    # Create backup directory (used by the backup API route)
    mkdir -p /var/backups/ceymail
    chown "$SERVICE_USER:$SERVICE_USER" /var/backups/ceymail
    chmod 750 "$DATA_DIR"
    log "Data directory ready: $DATA_DIR"

    # Clone repo if not present
    if [ ! -d "$REPO_DIR/.git" ]; then
        git clone https://github.com/derricksiawor/ceymail-mission-control.git "$REPO_DIR"
        log "Cloned repository to $REPO_DIR"
    fi

    # Install Node.js if not present
    if ! command -v node &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        apt-get install -y nodejs
        log "Installed Node.js $(node --version)"
    fi
fi

# ── Pull latest code ──
log "Pulling latest code..."
cd "$REPO_DIR"
# Reset local changes that could block pull (build artifacts, modified configs)
git fetch origin main
git reset --hard origin/main

# ── Install/update sudoers ──
log "Installing sudoers rules..."
# Validate BEFORE making live to avoid breaking sudo during the window
SUDOERS_TMP=$(mktemp /tmp/ceymail-mc-sudoers.XXXXXX)
cp "$REPO_DIR/deploy/sudoers/ceymail-mc" "$SUDOERS_TMP"
chmod 0440 "$SUDOERS_TMP"
if visudo -c -f "$SUDOERS_TMP" &>/dev/null; then
    mv "$SUDOERS_TMP" /etc/sudoers.d/ceymail-mc
    log "Sudoers syntax OK"
else
    err "Sudoers syntax check FAILED - not deploying"
    rm -f "$SUDOERS_TMP"
    exit 1
fi

# ── Install/update helper scripts ──
log "Installing helper scripts..."
for script_pair in \
    "ceymail-roundcube-db.sh:ceymail-roundcube-db" \
    "ceymail-nginx-webmail.sh:ceymail-nginx-webmail" \
    "ceymail-apache2-webmail.sh:ceymail-apache2-webmail" \
    "ceymail-backup.sh:ceymail-backup"; do
    src="$REPO_DIR/deploy/scripts/${script_pair%%:*}"
    dst="/usr/local/bin/${script_pair##*:}"
    if [ ! -f "$src" ]; then
        err "Helper script not found: $src"
        exit 1
    fi
    cp "$src" "$dst"
    chmod 755 "$dst"
    chown root:root "$dst"
done

# ── Install/update polkit rules ──
log "Installing polkit rules..."
cp "$REPO_DIR/deploy/polkit/45-ceymail-mc.rules" /usr/share/polkit-1/rules.d/45-ceymail-mc.rules
chmod 644 /usr/share/polkit-1/rules.d/45-ceymail-mc.rules

# ── Install/update systemd service ──
log "Installing systemd service..."
cp "$REPO_DIR/deploy/systemd/ceymail-dashboard.service" /etc/systemd/system/ceymail-dashboard.service
systemctl daemon-reload
systemctl enable ceymail-dashboard
log "Systemd service installed and enabled"

# ── Preserve runtime config before build wipes standalone ──
# The build creates a fresh .next/standalone/ directory, destroying any
# config changes made at runtime (e.g. installCompletedAt set via /install).
# Back up the live config so the restore step below has the latest state.
if [ -f "$STANDALONE_DIR/data/config.json" ]; then
    cp "$STANDALONE_DIR/data/config.json" "$DATA_DIR/config.json"
    chmod 600 "$DATA_DIR/config.json"
    log "Backed up live config to $DATA_DIR/config.json"
fi
if [ -f "$STANDALONE_DIR/.env.local" ]; then
    cp "$STANDALONE_DIR/.env.local" "$DATA_DIR/.env.local"
    chmod 600 "$DATA_DIR/.env.local"
    log "Backed up .env.local to $DATA_DIR/.env.local"
fi

# ── Backup existing standalone for rollback ──
ROLLBACK_DIR=""
if [ -d "$STANDALONE_DIR" ]; then
    # Clean stale rollback dirs from previously interrupted deploys
    find "$DATA_DIR" -maxdepth 1 -name 'rollback-*' -type d -mmin +60 -exec rm -rf {} + 2>/dev/null || true

    ROLLBACK_DIR="$DATA_DIR/rollback-$(date +%s)"
    mv "$STANDALONE_DIR" "$ROLLBACK_DIR"
    log "Moved existing build to $ROLLBACK_DIR for rollback"
fi

# ── Install npm dependencies ──
log "Installing dependencies..."
cd "$DASHBOARD_DIR"
if ! npm install --include=dev 2>&1 | tail -3; then
    err "npm install failed!"
    if [ -n "$ROLLBACK_DIR" ] && [ -d "$ROLLBACK_DIR" ]; then
        warn "Restoring previous build from $ROLLBACK_DIR..."
        rm -rf "$STANDALONE_DIR"
        mv "$ROLLBACK_DIR" "$STANDALONE_DIR"
        chown -R "$SERVICE_USER:$SERVICE_USER" "$STANDALONE_DIR"
        systemctl restart ceymail-dashboard || true
        warn "Previous build restored."
    fi
    exit 1
fi

# ── Build ──
log "Building dashboard..."
if ! npm run build 2>&1 | tail -10; then
    err "Build failed!"
    if [ -n "$ROLLBACK_DIR" ] && [ -d "$ROLLBACK_DIR" ]; then
        warn "Restoring previous build from $ROLLBACK_DIR..."
        rm -rf "$STANDALONE_DIR"
        mv "$ROLLBACK_DIR" "$STANDALONE_DIR"
        chown -R "$SERVICE_USER:$SERVICE_USER" "$STANDALONE_DIR"
        systemctl restart ceymail-dashboard || true
        warn "Previous build restored. Dashboard should still be running."
    fi
    exit 1
fi

# ── Verify build output ──
if [ ! -f ".next/standalone/server.js" ]; then
    err "Build succeeded but standalone/server.js not found!"
    if [ -n "$ROLLBACK_DIR" ] && [ -d "$ROLLBACK_DIR" ]; then
        warn "Restoring previous build from $ROLLBACK_DIR..."
        rm -rf "$STANDALONE_DIR"
        mv "$ROLLBACK_DIR" "$STANDALONE_DIR"
        chown -R "$SERVICE_USER:$SERVICE_USER" "$STANDALONE_DIR"
        systemctl restart ceymail-dashboard || true
        warn "Previous build restored."
    fi
    exit 1
fi

# ── Post-build steps: static assets, config restore, ownership ──
# If any of these fail (set -e), auto-rollback to the previous build.
rollback_on_error() {
    err "Post-build step failed!"
    if [ -n "${ROLLBACK_DIR:-}" ] && [ -d "${ROLLBACK_DIR:-}" ]; then
        warn "Restoring previous build from $ROLLBACK_DIR..."
        rm -rf "$STANDALONE_DIR"
        mv "$ROLLBACK_DIR" "$STANDALONE_DIR"
        chown -R "$SERVICE_USER:$SERVICE_USER" "$STANDALONE_DIR"
        systemctl restart ceymail-dashboard || true
        warn "Previous build restored."
    fi
}
trap rollback_on_error ERR

log "Copying static assets..."
cp -r .next/static .next/standalone/.next/static
if [ -d public ]; then
    cp -r public .next/standalone/public
fi

# ── Restore config files ──
log "Restoring config files..."
mkdir -p "$STANDALONE_DIR/data"
if [ -f "$DATA_DIR/config.json" ]; then
    cp "$DATA_DIR/config.json" "$STANDALONE_DIR/data/config.json"
    chmod 600 "$STANDALONE_DIR/data/config.json"
    log "Config restored from $DATA_DIR/config.json"
fi
if [ -f "$DATA_DIR/.env.local" ]; then
    cp "$DATA_DIR/.env.local" "$STANDALONE_DIR/.env.local"
    chmod 600 "$STANDALONE_DIR/.env.local"
    log ".env.local restored"
fi

# ── Set ownership ──
log "Setting ownership..."
chown -R "$SERVICE_USER:$SERVICE_USER" "$STANDALONE_DIR"

# Disarm post-build rollback trap — remaining steps have their own error handling
trap - ERR

# ── Restart service ──
log "Restarting dashboard..."
systemctl restart ceymail-dashboard
sleep 3

# ── Verify ──
if systemctl is-active --quiet ceymail-dashboard; then
    log "Dashboard is running"
    systemctl status ceymail-dashboard --no-pager | head -8
else
    err "Dashboard failed to start!"
    journalctl -u ceymail-dashboard -n 10 --no-pager
    if [ -n "${ROLLBACK_DIR:-}" ] && [ -d "${ROLLBACK_DIR:-}" ]; then
        warn "Restoring previous build from $ROLLBACK_DIR..."
        rm -rf "$STANDALONE_DIR"
        mv "$ROLLBACK_DIR" "$STANDALONE_DIR"
        chown -R "$SERVICE_USER:$SERVICE_USER" "$STANDALONE_DIR"
        systemctl restart ceymail-dashboard || true
        warn "Previous build restored."
    fi
    exit 1
fi

# ── Cleanup rollback backup ──
if [ -n "${ROLLBACK_DIR:-}" ] && [ -d "${ROLLBACK_DIR:-}" ]; then
    rm -rf "$ROLLBACK_DIR"
    log "Cleaned up rollback backup"
fi

log "Deploy complete!"
