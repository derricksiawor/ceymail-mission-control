#!/bin/bash
set -e

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
if [ "$1" = "--initial" ]; then
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

    # Create data directory
    mkdir -p "$DATA_DIR/backups"
    chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"
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
git pull origin main

# ── Install/update sudoers ──
log "Installing sudoers rules..."
# Validate BEFORE making live to avoid breaking sudo during the window
cp "$REPO_DIR/deploy/sudoers/ceymail-mc" /tmp/ceymail-mc-sudoers.tmp
chmod 0440 /tmp/ceymail-mc-sudoers.tmp
if visudo -c -f /tmp/ceymail-mc-sudoers.tmp &>/dev/null; then
    mv /tmp/ceymail-mc-sudoers.tmp /etc/sudoers.d/ceymail-mc
    log "Sudoers syntax OK"
else
    err "Sudoers syntax check FAILED - not deploying"
    rm -f /tmp/ceymail-mc-sudoers.tmp
    exit 1
fi

# ── Install/update helper scripts ──
log "Installing helper scripts..."
cp "$REPO_DIR/deploy/scripts/ceymail-roundcube-db.sh" /usr/local/bin/ceymail-roundcube-db
chmod 755 /usr/local/bin/ceymail-roundcube-db
chown root:root /usr/local/bin/ceymail-roundcube-db
cp "$REPO_DIR/deploy/scripts/ceymail-nginx-webmail.sh" /usr/local/bin/ceymail-nginx-webmail
chmod 755 /usr/local/bin/ceymail-nginx-webmail
chown root:root /usr/local/bin/ceymail-nginx-webmail

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

# ── Install npm dependencies ──
log "Installing dependencies..."
cd "$DASHBOARD_DIR"
npm install --production=false 2>&1 | tail -3

# ── Build ──
log "Building dashboard..."
npm run build 2>&1 | tail -10

# ── Copy static assets into standalone (required by Next.js standalone output) ──
log "Copying static assets..."
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public

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
    exit 1
fi

log "Deploy complete!"
