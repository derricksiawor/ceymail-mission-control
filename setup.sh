#!/bin/bash
#
# CeyMail Mission Control — One-Command Setup
#
# Usage:
#   wget -qO- https://raw.githubusercontent.com/derricksiawor/ceymail-mission-control/main/setup.sh | sudo bash
#
# Or clone first:
#   sudo bash setup.sh
#
# Idempotent: safe to re-run. Saved config at /etc/ceymail.conf is reused.
#
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

REPO_URL="https://github.com/derricksiawor/ceymail-mission-control.git"
REPO_DIR="/opt/mission-control"
CONF_FILE="/etc/ceymail.conf"
DASHBOARD_PORT=3000

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}[ceymail]${NC} $1"; }
warn()  { echo -e "${YELLOW}[ceymail]${NC} $1"; }
err()   { echo -e "${RED}[ceymail]${NC} $1" >&2; }
fatal() { err "$1"; exit 1; }

banner() {
    echo ""
    echo -e "${BLUE}${BOLD}"
    echo "   ██████╗███████╗██╗   ██╗███╗   ███╗ █████╗ ██╗██╗     "
    echo "  ██╔════╝██╔════╝╚██╗ ██╔╝████╗ ████║██╔══██╗██║██║     "
    echo "  ██║     █████╗   ╚████╔╝ ██╔████╔██║███████║██║██║     "
    echo "  ██║     ██╔══╝    ╚██╔╝  ██║╚██╔╝██║██╔══██║██║██║     "
    echo "  ╚██████╗███████╗   ██║   ██║ ╚═╝ ██║██║  ██║██║███████╗"
    echo "   ╚═════╝╚══════╝   ╚═╝   ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝"
    echo -e "${NC}"
    echo -e "  ${BOLD}Mission Control Setup${NC}"
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Pre-flight checks
# ─────────────────────────────────────────────────────────────────────────────

preflight() {
    # Must be root
    if [ "$(id -u)" -ne 0 ]; then
        fatal "This script must be run as root. Use: sudo bash setup.sh"
    fi

    # Must be Ubuntu — parse os-release without sourcing to avoid clobbering variables
    if [ ! -f /etc/os-release ]; then
        fatal "Cannot detect OS. This script requires Ubuntu 22.04 or 24.04."
    fi
    local os_id os_version
    os_id=$(grep -m1 '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
    os_version=$(grep -m1 '^VERSION_ID=' /etc/os-release | cut -d= -f2 | tr -d '"')
    if [ "$os_id" != "ubuntu" ]; then
        fatal "This script requires Ubuntu. Detected: $os_id"
    fi
    case "$os_version" in
        22.04|24.04) info "Detected Ubuntu $os_version" ;;
        *) fatal "Unsupported Ubuntu version: $os_version. Requires 22.04 or 24.04." ;;
    esac

    # Memory check (minimum 512MB)
    MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    MEM_MB=$((MEM_KB / 1024))
    if [ "$MEM_MB" -lt 450 ]; then
        fatal "Insufficient memory: ${MEM_MB}MB. Minimum 512MB required."
    fi
    info "Memory: ${MEM_MB}MB"

    # Detect public IPv4 address
    SERVER_IP=$(curl -4 -s --max-time 5 ifconfig.me 2>/dev/null || true)
    # Validate we got a real public IPv4 address
    if ! echo "$SERVER_IP" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        # Fallback: try ip route to find the default interface's IP
        SERVER_IP=$(ip -4 route get 8.8.8.8 2>/dev/null | grep -oP 'src \K[0-9.]+' || true)
    fi
    if [ -z "$SERVER_IP" ]; then
        fatal "Could not detect server public IP address. Set SERVER_IP manually in $CONF_FILE."
    fi
    info "Server IP: $SERVER_IP"
}

# ─────────────────────────────────────────────────────────────────────────────
# Load existing config (for idempotent re-runs)
# ─────────────────────────────────────────────────────────────────────────────

load_config() {
    MAIL_DOMAIN=""
    DASHBOARD_DOMAIN=""
    CERTBOT_EMAIL=""
    WEB_SERVER=""

    if [ -f "$CONF_FILE" ]; then
        # Parse key=value pairs safely without executing arbitrary shell code
        while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ "$key" =~ ^[[:space:]]*# ]] && continue
            [[ -z "$key" ]] && continue
            # Strip leading/trailing whitespace from key
            key=$(echo "$key" | tr -d '[:space:]')
            # Strip surrounding quotes from value
            value="${value%\"}"
            value="${value#\"}"
            value="${value%\'}"
            value="${value#\'}"
            case "$key" in
                MAIL_DOMAIN)      MAIL_DOMAIN="$value" ;;
                DASHBOARD_DOMAIN) DASHBOARD_DOMAIN="$value" ;;
                CERTBOT_EMAIL)    CERTBOT_EMAIL="$value" ;;
                WEB_SERVER)       WEB_SERVER="$value" ;;
                SERVER_IP)        ;; # Ignored — re-detected at runtime
            esac
        done < "$CONF_FILE"
        info "Loaded existing config from $CONF_FILE"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Interactive prompts
# ─────────────────────────────────────────────────────────────────────────────

gather_inputs() {
    echo ""
    echo -e "${BOLD}Configuration${NC}"
    echo ""

    # Mail domain
    local default_mail="${MAIL_DOMAIN:-}"
    if [ -n "$default_mail" ]; then
        read -rp "  Mail domain [$default_mail]: " input < /dev/tty
        MAIL_DOMAIN="${input:-$default_mail}"
    else
        while [ -z "$MAIL_DOMAIN" ]; do
            read -rp "  Mail domain (e.g., example.com): " MAIL_DOMAIN < /dev/tty
            if [ -z "$MAIL_DOMAIN" ]; then
                warn "  Mail domain is required."
            fi
        done
    fi

    # Validate domain format
    if [[ ! "$MAIL_DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$ ]] || \
       [ ${#MAIL_DOMAIN} -gt 253 ]; then
        fatal "Invalid mail domain: $MAIL_DOMAIN"
    fi

    # Dashboard subdomain
    local default_dash="${DASHBOARD_DOMAIN:-mc.$MAIL_DOMAIN}"
    read -rp "  Dashboard subdomain (e.g., mc.example.com): " input < /dev/tty
    DASHBOARD_DOMAIN="${input:-$default_dash}"

    # Validate dashboard domain format
    if [[ ! "$DASHBOARD_DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$ ]] || \
       [ ${#DASHBOARD_DOMAIN} -gt 253 ]; then
        fatal "Invalid dashboard domain: $DASHBOARD_DOMAIN"
    fi

    # Certbot email
    local default_email="${CERTBOT_EMAIL:-admin@$MAIL_DOMAIN}"
    read -rp "  Email for Let's Encrypt [$default_email]: " input < /dev/tty
    CERTBOT_EMAIL="${input:-$default_email}"

    # Validate email format
    if [[ ! "$CERTBOT_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
        fatal "Invalid email address: $CERTBOT_EMAIL"
    fi

    echo ""
    info "Mail domain:     $MAIL_DOMAIN"
    info "Dashboard:       $DASHBOARD_DOMAIN"
    info "Certbot email:   $CERTBOT_EMAIL"
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Save config
# ─────────────────────────────────────────────────────────────────────────────

save_config() {
    cat > "$CONF_FILE" <<EOF
# CeyMail Mission Control — setup config (auto-generated)
# Re-run setup.sh to update. Values are used as defaults.
MAIL_DOMAIN="$MAIL_DOMAIN"
DASHBOARD_DOMAIN="$DASHBOARD_DOMAIN"
CERTBOT_EMAIL="$CERTBOT_EMAIL"
WEB_SERVER="$WEB_SERVER"
SERVER_IP="$SERVER_IP"
EOF
    chmod 600 "$CONF_FILE"
    info "Config saved to $CONF_FILE"
}

# ─────────────────────────────────────────────────────────────────────────────
# System setup
# ─────────────────────────────────────────────────────────────────────────────

setup_system() {
    local first_run="${1:-true}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq

    # Only run full upgrade on first run, not re-runs
    if [ "$first_run" = "true" ]; then
        info "First run — upgrading system packages..."
        apt-get upgrade -y -qq
    else
        info "Re-run — skipping system upgrade (run manually if needed)"
    fi

    # Set hostname
    local current_hostname
    current_hostname=$(hostname -f 2>/dev/null || hostname)
    if [ "$current_hostname" != "$MAIL_DOMAIN" ]; then
        hostnamectl set-hostname "$MAIL_DOMAIN"
        # Update /etc/hosts — only remove CeyMail-managed entries (identified by marker
        # comment), preserving any pre-existing 127.0.1.1 entries from the OS or other tools
        sed -i '/# ceymail$/d' /etc/hosts
        echo "127.0.1.1 $MAIL_DOMAIN # ceymail" >> /etc/hosts
        info "Hostname set to $MAIL_DOMAIN"
    else
        info "Hostname already set to $MAIL_DOMAIN"
    fi
}

setup_firewall() {
    if ! command -v ufw &>/dev/null; then
        apt-get install -y -qq ufw
    fi

    # Configure rules idempotently (ufw allow is safe to re-run, never reset)
    ufw default deny incoming &>/dev/null
    ufw default allow outgoing &>/dev/null
    ufw allow 22/tcp &>/dev/null    # SSH
    ufw allow 25/tcp &>/dev/null    # SMTP
    ufw allow 80/tcp &>/dev/null    # HTTP
    ufw allow 443/tcp &>/dev/null   # HTTPS
    ufw allow 587/tcp &>/dev/null   # Submission
    ufw allow 993/tcp &>/dev/null   # IMAPS
    ufw --force enable &>/dev/null
    info "Firewall configured (SSH, SMTP, HTTP, HTTPS, submission, IMAPS)"
}

# ─────────────────────────────────────────────────────────────────────────────
# Detect web server
# ─────────────────────────────────────────────────────────────────────────────

detect_web_server() {
    # On re-runs, respect the saved web server preference from /etc/ceymail.conf
    if [ -n "$WEB_SERVER" ]; then
        info "Using saved web server preference: $WEB_SERVER"
        return
    fi

    local nginx_active=false
    local apache_active=false

    if systemctl is-active --quiet nginx 2>/dev/null; then
        nginx_active=true
    fi
    if systemctl is-active --quiet apache2 2>/dev/null; then
        apache_active=true
    fi

    if [ "$nginx_active" = true ] && [ "$apache_active" = false ]; then
        WEB_SERVER="nginx"
        info "Detected web server: Nginx"
    elif [ "$apache_active" = true ] && [ "$nginx_active" = false ]; then
        WEB_SERVER="apache2"
        info "Detected web server: Apache"
    elif [ "$nginx_active" = true ] && [ "$apache_active" = true ]; then
        WEB_SERVER="nginx"
        warn "Both Nginx and Apache are running. Using Nginx (preferred)."
    else
        # Check if either is installed but not running
        if command -v nginx &>/dev/null; then
            WEB_SERVER="nginx"
            info "Nginx is installed (not running). Will use Nginx."
        elif command -v apache2 &>/dev/null; then
            WEB_SERVER="apache2"
            info "Apache is installed (not running). Will use Apache."
        else
            WEB_SERVER="nginx"
            info "No web server found. Installing Nginx."
        fi
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Install dependencies
# ─────────────────────────────────────────────────────────────────────────────

install_dependencies() {
    export DEBIAN_FRONTEND=noninteractive

    # Git
    if ! command -v git &>/dev/null; then
        info "Installing git..."
        apt-get install -y -qq git
    fi

    # Node.js 22
    if ! command -v node &>/dev/null; then
        info "Installing Node.js 22..."
        if ! curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>&1 | tail -5; then
            fatal "NodeSource setup failed. Check network connectivity."
        fi
        apt-get install -y -qq nodejs
        info "Node.js $(node --version) installed"
    else
        local node_major
        node_major=$(node --version | cut -d. -f1 | tr -d 'v')
        if [ "$node_major" -lt 22 ]; then
            warn "Node.js $(node --version) is too old. Installing Node.js 22..."
            if ! curl -fsSL https://deb.nodesource.com/setup_22.x | bash - 2>&1 | tail -5; then
                fatal "NodeSource setup failed. Check network connectivity."
            fi
            apt-get install -y -qq nodejs
            info "Node.js $(node --version) installed"
        else
            info "Node.js $(node --version) already installed"
        fi
    fi

    # MariaDB
    if ! command -v mysql &>/dev/null; then
        info "Installing MariaDB..."
        apt-get install -y -qq mariadb-server
        systemctl enable mariadb &>/dev/null
        systemctl start mariadb
        info "MariaDB installed (unix_socket auth, no root password needed)"
    else
        info "MariaDB already installed"
    fi

    # Web server
    if [ "$WEB_SERVER" = "nginx" ]; then
        if ! command -v nginx &>/dev/null; then
            info "Installing Nginx..."
            apt-get install -y -qq nginx
            systemctl enable nginx &>/dev/null
        fi
        # Certbot for Nginx
        apt-get install -y -qq certbot python3-certbot-nginx
    else
        # Apache is already installed — enable required modules
        info "Enabling Apache modules for reverse proxy..."
        if ! a2enmod proxy proxy_http proxy_wstunnel ssl rewrite headers 2>&1 | tail -3; then
            fatal "Failed to enable required Apache modules"
        fi
        # Certbot for Apache
        apt-get install -y -qq certbot python3-certbot-apache
    fi

    # DNS tools for resolution check
    if ! command -v dig &>/dev/null; then
        apt-get install -y -qq dnsutils
    fi

    info "All dependencies installed"
}

# ─────────────────────────────────────────────────────────────────────────────
# Database provisioning
# ─────────────────────────────────────────────────────────────────────────────

setup_database() {
    info "Setting up databases..."

    # Verify MariaDB is running and accepting connections
    if ! mysql -e "SELECT 1" &>/dev/null; then
        systemctl start mariadb 2>/dev/null || true
        sleep 2
        if ! mysql -e "SELECT 1" &>/dev/null; then
            fatal "MariaDB is not running. Check: systemctl status mariadb"
        fi
    fi

    local DB_PASSWORD=""
    local SESSION_SECRET=""
    local REUSING_CREDS=false

    # On re-runs, reuse existing credentials to avoid breaking the running dashboard
    if [ -f /var/lib/ceymail-mc/config.json ]; then
        DB_PASSWORD=$(python3 -c "import json; print(json.load(open('/var/lib/ceymail-mc/config.json'))['database']['password'])" 2>/dev/null || true)
        SESSION_SECRET=$(python3 -c "import json; print(json.load(open('/var/lib/ceymail-mc/config.json'))['session']['secret'])" 2>/dev/null || true)
        if [ -n "$DB_PASSWORD" ] && [ -n "$SESSION_SECRET" ]; then
            REUSING_CREDS=true
            info "Reusing existing database credentials"
        fi
    fi

    # Generate fresh credentials only on first run (or if config parsing failed)
    if [ -z "$DB_PASSWORD" ]; then
        DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
        if [ ${#DB_PASSWORD} -lt 16 ]; then
            DB_PASSWORD=$(openssl rand -hex 16)
        fi
    fi
    if [ -z "$SESSION_SECRET" ]; then
        SESSION_SECRET=$(openssl rand -hex 32)
    fi

    # Create databases
    mysql -e "CREATE DATABASE IF NOT EXISTS ceymail CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    mysql -e "CREATE DATABASE IF NOT EXISTS ceymail_dashboard CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
    info "Databases created"

    # Create or verify database user (pipe via stdin to keep password out of ps)
    if [ "$REUSING_CREDS" = false ]; then
        mysql <<SQL
DROP USER IF EXISTS 'ceymail'@'localhost';
CREATE USER 'ceymail'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
SQL
        info "Database user created"
    else
        # Verify user still exists (may have been manually deleted while config persists)
        if ! mysql -e "SELECT 1 FROM mysql.user WHERE User='ceymail' AND Host='localhost'" 2>/dev/null | grep -q 1; then
            warn "Database user 'ceymail' was deleted. Recreating..."
            mysql <<SQL
CREATE USER 'ceymail'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
SQL
            info "Database user recreated"
        fi
    fi
    mysql -e "GRANT ALL PRIVILEGES ON ceymail.* TO 'ceymail'@'localhost';"
    mysql -e "GRANT ALL PRIVILEGES ON ceymail_dashboard.* TO 'ceymail'@'localhost';"
    mysql -e "FLUSH PRIVILEGES;"

    # Create mail tables (ceymail database)
    mysql ceymail <<'SQL'
CREATE TABLE IF NOT EXISTS virtual_domains (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS virtual_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    domain_id INT NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    quota BIGINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (domain_id) REFERENCES virtual_domains(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS virtual_aliases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    domain_id INT NOT NULL,
    source VARCHAR(255) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (domain_id) REFERENCES virtual_domains(id) ON DELETE CASCADE,
    UNIQUE KEY unique_alias (source, destination)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
SQL
    info "Mail tables created"

    # Create dashboard tables (ceymail_dashboard database)
    mysql ceymail_dashboard <<'SQL'
CREATE TABLE IF NOT EXISTS dashboard_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role ENUM('admin', 'viewer') DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(100) NOT NULL,
    target VARCHAR(255),
    detail TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS install_state (
    id INT AUTO_INCREMENT PRIMARY KEY,
    step_index INT NOT NULL DEFAULT 0,
    step_name VARCHAR(100) NOT NULL,
    status ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
    form_data JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS health_snapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    cpu_percent FLOAT DEFAULT 0,
    memory_used_bytes BIGINT DEFAULT 0,
    disk_used_bytes BIGINT DEFAULT 0,
    mail_queue_size INT DEFAULT 0,
    services_healthy INT DEFAULT 0,
    services_total INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
SQL
    info "Dashboard tables created"

    # Verify the ceymail user can connect (use defaults-extra-file to keep password out of ps)
    (
        MYSQL_CNF=$(mktemp /tmp/.mc-dbcheck.XXXXXX)
        trap "rm -f '$MYSQL_CNF'" EXIT
        chmod 600 "$MYSQL_CNF"
        printf '[client]\nuser=ceymail\npassword=%s\n' "$DB_PASSWORD" > "$MYSQL_CNF"
        mysql --defaults-extra-file="$MYSQL_CNF" -e "SELECT 1;" &>/dev/null
    ) || fatal "Database user verification failed"
    info "Database user verified"

    # Write config files only on first run (re-runs keep existing config intact)
    mkdir -p /var/lib/ceymail-mc
    chmod 700 /var/lib/ceymail-mc
    if [ "$REUSING_CREDS" = false ]; then
        # Create files with secure permissions before writing sensitive data
        install -m 600 /dev/null /var/lib/ceymail-mc/config.json
        cat > /var/lib/ceymail-mc/config.json <<CONF
{
  "version": 1,
  "database": {
    "host": "localhost",
    "port": 3306,
    "user": "ceymail",
    "password": "${DB_PASSWORD}",
    "mailDatabase": "ceymail",
    "dashboardDatabase": "ceymail_dashboard"
  },
  "session": {
    "secret": "${SESSION_SECRET}"
  },
  "setupCompletedAt": null,
  "installCompletedAt": null
}
CONF
        install -m 600 /dev/null /var/lib/ceymail-mc/.env.local
        echo "SESSION_SECRET=${SESSION_SECRET}" > /var/lib/ceymail-mc/.env.local
    fi

    # Set ownership if the service user already exists
    if id ceymail-mc &>/dev/null; then
        chown -R ceymail-mc:ceymail-mc /var/lib/ceymail-mc
    fi

    info "Databases created and configured"
}

# ─────────────────────────────────────────────────────────────────────────────
# Clone or update repository
# ─────────────────────────────────────────────────────────────────────────────

setup_repo() {
    if [ -d "$REPO_DIR/.git" ]; then
        info "Updating existing repository..."
        cd "$REPO_DIR"
        # Reset any local changes that could block pull (deploy modifies standalone/)
        git fetch origin main --quiet
        git reset --quiet --hard origin/main 2>/dev/null || git reset --hard origin/main
    else
        info "Cloning CeyMail Mission Control..."
        git clone --quiet "$REPO_URL" "$REPO_DIR"
    fi
    info "Repository ready at $REPO_DIR"
}

# ─────────────────────────────────────────────────────────────────────────────
# Deploy dashboard
# ─────────────────────────────────────────────────────────────────────────────

deploy_dashboard() {
    local deploy_script="$REPO_DIR/deploy/scripts/deploy-dashboard.sh"
    if [ ! -f "$deploy_script" ]; then
        fatal "Deploy script not found: $deploy_script"
    fi

    info "Running dashboard deploy (this may take a few minutes)..."
    bash "$deploy_script" --initial
    info "Dashboard deployed and running on port $DASHBOARD_PORT"
}

# ─────────────────────────────────────────────────────────────────────────────
# Generate web server config
# ─────────────────────────────────────────────────────────────────────────────

generate_nginx_config() {
    local config_file="/etc/nginx/sites-available/$DASHBOARD_DOMAIN"

    # Skip if config already exists and has SSL
    if [ -f "$config_file" ] && grep -q "ssl_certificate" "$config_file" 2>/dev/null; then
        info "Nginx config for $DASHBOARD_DOMAIN already exists with SSL"
        return
    fi

    cat > "$config_file" <<NGINX
# CeyMail Mission Control — $DASHBOARD_DOMAIN
# Auto-generated by setup.sh

limit_req_zone \$binary_remote_addr zone=mc_general:10m rate=10r/s;
limit_req_zone \$binary_remote_addr zone=mc_api:10m rate=30r/s;
limit_req_zone \$binary_remote_addr zone=mc_login:10m rate=3r/m;

server {
    listen 80;
    listen [::]:80;
    server_name $DASHBOARD_DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DASHBOARD_DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DASHBOARD_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DASHBOARD_DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 1.1.1.1 8.8.8.8 valid=300s;

    # Strip upstream CSP header — Nginx is the authoritative CSP source.
    # Next.js sends its own CSP (for dev mode) which is more restrictive
    # and would block WebSocket/external connections in production.
    proxy_hide_header Content-Security-Policy;

    server_tokens off;
    client_max_body_size 10M;

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT;
        # Note: add_header in a location block overrides server-level add_header,
        # so all security headers must be repeated here.
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';" always;
    }

    location /api/welcome/login {
        limit_req zone=mc_login burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }

    location /api/ {
        limit_req zone=mc_api burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }

    location / {
        limit_req zone=mc_general burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location ~ /\\. {
        deny all;
        return 404;
    }
}
NGINX

    # Remove stale CeyMail Nginx configs from previous domain (prevents duplicate limit_req_zone)
    for f in /etc/nginx/sites-enabled/*; do
        [ -e "$f" ] || continue
        local basename
        basename=$(basename "$f")
        if [ "$basename" != "$DASHBOARD_DOMAIN" ] && grep -q "# CeyMail Mission Control" "$f" 2>/dev/null; then
            rm -f "$f"
            rm -f "/etc/nginx/sites-available/$basename"
            info "Removed stale Nginx config: $basename"
        fi
    done

    # Enable site (only remove default site if it's the stock Nginx default)
    if [ -L /etc/nginx/sites-enabled/default ] && \
       [ "$(readlink -f /etc/nginx/sites-enabled/default)" = "/etc/nginx/sites-available/default" ]; then
        rm -f /etc/nginx/sites-enabled/default
    fi
    ln -sf "$config_file" "/etc/nginx/sites-enabled/$DASHBOARD_DOMAIN"
    info "Nginx config generated for $DASHBOARD_DOMAIN"
}

generate_nginx_config_http_only() {
    local config_file="/etc/nginx/sites-available/$DASHBOARD_DOMAIN"

    cat > "$config_file" <<NGINX
# CeyMail Mission Control — $DASHBOARD_DOMAIN (HTTP only — run setup.sh again after DNS to enable SSL)

limit_req_zone \$binary_remote_addr zone=mc_general:10m rate=10r/s;
limit_req_zone \$binary_remote_addr zone=mc_api:10m rate=30r/s;
limit_req_zone \$binary_remote_addr zone=mc_login:10m rate=3r/m;

server {
    listen 80;
    listen [::]:80;
    server_name $DASHBOARD_DOMAIN;

    server_tokens off;
    client_max_body_size 10M;

    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location /api/welcome/login {
        limit_req zone=mc_login burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /api/ {
        limit_req zone=mc_api burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        limit_req zone=mc_general burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:$DASHBOARD_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location ~ /\\. {
        deny all;
        return 404;
    }
}
NGINX

    # Remove stale CeyMail Nginx configs from previous domain (prevents duplicate limit_req_zone)
    for f in /etc/nginx/sites-enabled/*; do
        [ -e "$f" ] || continue
        local basename
        basename=$(basename "$f")
        if [ "$basename" != "$DASHBOARD_DOMAIN" ] && grep -q "# CeyMail Mission Control" "$f" 2>/dev/null; then
            rm -f "$f"
            rm -f "/etc/nginx/sites-available/$basename"
            info "Removed stale Nginx config: $basename"
        fi
    done

    if [ -L /etc/nginx/sites-enabled/default ] && \
       [ "$(readlink -f /etc/nginx/sites-enabled/default)" = "/etc/nginx/sites-available/default" ]; then
        rm -f /etc/nginx/sites-enabled/default
    fi
    ln -sf "$config_file" "/etc/nginx/sites-enabled/$DASHBOARD_DOMAIN"
    info "Nginx HTTP-only config generated (SSL will be added once DNS resolves)"
}

generate_apache_config() {
    local config_file="/etc/apache2/sites-available/$DASHBOARD_DOMAIN.conf"

    # Skip if config already exists and has SSL
    if [ -f "$config_file" ] && grep -q "SSLEngine" "$config_file" 2>/dev/null; then
        info "Apache config for $DASHBOARD_DOMAIN already exists with SSL"
        return
    fi

    cat > "$config_file" <<APACHE
# CeyMail Mission Control — $DASHBOARD_DOMAIN
# Auto-generated by setup.sh

<VirtualHost *:80>
    ServerName $DASHBOARD_DOMAIN
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:443>
    ServerName $DASHBOARD_DOMAIN

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/$DASHBOARD_DOMAIN/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$DASHBOARD_DOMAIN/privkey.pem

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:$DASHBOARD_PORT/
    ProxyPassReverse / http://127.0.0.1:$DASHBOARD_PORT/

    # Strip upstream CSP header — Apache is the authoritative CSP source.
    # Next.js sends its own CSP (for dev mode) which is more restrictive
    # and would block WebSocket/external connections in production.
    Header unset Content-Security-Policy

    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule /(.*) ws://127.0.0.1:$DASHBOARD_PORT/\$1 [P,L]

    # Security headers
    Header always set Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
    Header always set X-Frame-Options "DENY"
    Header always set X-Content-Type-Options "nosniff"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
    Header always set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';"
</VirtualHost>
APACHE

    # Remove stale CeyMail Apache configs from previous domain
    for f in /etc/apache2/sites-enabled/*.conf; do
        [ -e "$f" ] || continue
        local basename
        basename=$(basename "$f" .conf)
        if [ "$basename" != "$DASHBOARD_DOMAIN" ] && grep -q "# CeyMail Mission Control" "/etc/apache2/sites-available/${basename}.conf" 2>/dev/null; then
            a2dissite "$basename" &>/dev/null || true
            rm -f "/etc/apache2/sites-available/${basename}.conf"
            info "Removed stale Apache config: $basename"
        fi
    done

    a2ensite "$DASHBOARD_DOMAIN" &>/dev/null
    info "Apache config generated for $DASHBOARD_DOMAIN"
}

generate_apache_config_http_only() {
    local config_file="/etc/apache2/sites-available/$DASHBOARD_DOMAIN.conf"

    cat > "$config_file" <<APACHE
# CeyMail Mission Control — $DASHBOARD_DOMAIN (HTTP only — run setup.sh again after DNS to enable SSL)

<VirtualHost *:80>
    ServerName $DASHBOARD_DOMAIN

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:$DASHBOARD_PORT/
    ProxyPassReverse / http://127.0.0.1:$DASHBOARD_PORT/

    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule /(.*) ws://127.0.0.1:$DASHBOARD_PORT/\$1 [P,L]

    # Security headers
    Header always set X-Frame-Options "DENY"
    Header always set X-Content-Type-Options "nosniff"
    Header always set Referrer-Policy "strict-origin-when-cross-origin"
    Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
</VirtualHost>
APACHE

    # Remove stale CeyMail Apache configs from previous domain
    for f in /etc/apache2/sites-enabled/*.conf; do
        [ -e "$f" ] || continue
        local basename
        basename=$(basename "$f" .conf)
        if [ "$basename" != "$DASHBOARD_DOMAIN" ] && grep -q "# CeyMail Mission Control" "/etc/apache2/sites-available/${basename}.conf" 2>/dev/null; then
            a2dissite "$basename" &>/dev/null || true
            rm -f "/etc/apache2/sites-available/${basename}.conf"
            info "Removed stale Apache config: $basename"
        fi
    done

    a2ensite "$DASHBOARD_DOMAIN" &>/dev/null
    info "Apache HTTP-only config generated (SSL will be added once DNS resolves)"
}

# ─────────────────────────────────────────────────────────────────────────────
# SSL certificates
# ─────────────────────────────────────────────────────────────────────────────

setup_ssl() {
    local dns_ready=true

    # Check if dashboard domain resolves to this server
    # Use dig A record type to resolve through CNAMEs to the final IP
    local resolved_dash
    resolved_dash=$(dig +short A "$DASHBOARD_DOMAIN" @8.8.8.8 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tail -1)
    if [ "$resolved_dash" != "$SERVER_IP" ]; then
        dns_ready=false
        warn "DNS: $DASHBOARD_DOMAIN does not resolve to $SERVER_IP (got: ${resolved_dash:-nothing})"
    fi

    # Check if mail domain resolves to this server
    local resolved_mail
    resolved_mail=$(dig +short A "$MAIL_DOMAIN" @8.8.8.8 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | tail -1)
    if [ "$resolved_mail" != "$SERVER_IP" ]; then
        dns_ready=false
        warn "DNS: $MAIL_DOMAIN does not resolve to $SERVER_IP (got: ${resolved_mail:-nothing})"
    fi

    if [ "$dns_ready" = false ]; then
        warn ""
        warn "DNS is not yet pointing to this server. SSL setup skipped."
        warn ""
        warn "Add these DNS A records, then re-run this script:"
        warn "  $DASHBOARD_DOMAIN  →  $SERVER_IP"
        warn "  $MAIL_DOMAIN       →  $SERVER_IP"
        warn ""

        # Generate HTTP-only config
        if [ "$WEB_SERVER" = "nginx" ]; then
            generate_nginx_config_http_only
            if nginx -t 2>&1 | tail -2; then
                systemctl reload nginx
            else
                warn "Nginx config test failed — check config manually"
            fi
        else
            generate_apache_config_http_only
            if apache2ctl configtest 2>&1 | tail -2; then
                systemctl reload apache2
            else
                warn "Apache config test failed — check config manually"
            fi
        fi
        return
    fi

    info "DNS verified. Obtaining SSL certificates..."

    # Generate HTTP-only config first so certbot has a server block to use for ACME challenge.
    # Without this, certbot --nginx/--apache fails on first install because no server_name exists.
    if [ "$WEB_SERVER" = "nginx" ]; then
        generate_nginx_config_http_only
        if nginx -t 2>&1 | tail -2; then
            systemctl reload nginx
        fi
    else
        generate_apache_config_http_only
        if apache2ctl configtest 2>&1 | tail -2; then
            systemctl reload apache2
        fi
    fi

    local certbot_plugin="--nginx"
    if [ "$WEB_SERVER" = "apache2" ]; then
        certbot_plugin="--apache"
    fi

    # Dashboard domain cert
    if [ ! -d "/etc/letsencrypt/live/$DASHBOARD_DOMAIN" ]; then
        info "Requesting certificate for $DASHBOARD_DOMAIN..."
        if ! certbot certonly "$certbot_plugin" \
            -d "$DASHBOARD_DOMAIN" \
            --non-interactive \
            --agree-tos \
            -m "$CERTBOT_EMAIL" 2>&1 | tail -5; then
            warn "Failed to obtain cert for $DASHBOARD_DOMAIN"
        fi
    else
        info "Certificate for $DASHBOARD_DOMAIN already exists"
    fi

    # Mail domain cert
    if [ ! -d "/etc/letsencrypt/live/$MAIL_DOMAIN" ]; then
        info "Requesting certificate for $MAIL_DOMAIN..."
        if ! certbot certonly "$certbot_plugin" \
            -d "$MAIL_DOMAIN" \
            --non-interactive \
            --agree-tos \
            -m "$CERTBOT_EMAIL" 2>&1 | tail -5; then
            warn "Failed to obtain cert for $MAIL_DOMAIN"
        fi
    else
        info "Certificate for $MAIL_DOMAIN already exists"
    fi

    # Only generate full SSL config if the dashboard cert was actually obtained
    if [ ! -f "/etc/letsencrypt/live/$DASHBOARD_DOMAIN/fullchain.pem" ]; then
        warn "Dashboard SSL certificate not found — falling back to HTTP-only config"
        if [ "$WEB_SERVER" = "nginx" ]; then
            generate_nginx_config_http_only
            if nginx -t 2>&1 | tail -2; then
                systemctl reload nginx
            else
                warn "Nginx config test failed — check config manually"
            fi
        else
            generate_apache_config_http_only
            if apache2ctl configtest 2>&1 | tail -2; then
                systemctl reload apache2
            else
                warn "Apache config test failed — check config manually"
            fi
        fi
        return
    fi

    # Generate full config with SSL
    if [ "$WEB_SERVER" = "nginx" ]; then
        # Ensure dhparam exists (certbot usually creates this)
        if [ ! -f /etc/letsencrypt/ssl-dhparams.pem ]; then
            openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048 2>/dev/null
        fi
        if [ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]; then
            # Certbot didn't create the options file — create a minimal one
            cat > /etc/letsencrypt/options-ssl-nginx.conf <<'SSLCONF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384";
SSLCONF
        fi
        generate_nginx_config
        if nginx -t 2>&1 | tail -2; then
            systemctl reload nginx
        else
            warn "Nginx config test failed — check config manually"
        fi
    else
        generate_apache_config
        if apache2ctl configtest 2>&1 | tail -2; then
            systemctl reload apache2
        else
            warn "Apache config test failed — check config manually"
        fi
    fi

    # Enable auto-renewal
    systemctl enable certbot.timer &>/dev/null || true
    systemctl start certbot.timer &>/dev/null || true

    info "SSL certificates installed and auto-renewal enabled"
}

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────

print_summary() {
    local protocol="https"
    if [ ! -d "/etc/letsencrypt/live/$DASHBOARD_DOMAIN" ]; then
        protocol="http"
    fi

    echo ""
    echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}  CeyMail Mission Control — Setup Complete${NC}"
    echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${BOLD}Dashboard:${NC}  ${protocol}://${DASHBOARD_DOMAIN}"
    echo -e "  ${BOLD}Web server:${NC} ${WEB_SERVER}"
    echo -e "  ${BOLD}Server IP:${NC}  ${SERVER_IP}"
    echo ""
    echo -e "  ${BOLD}Next steps:${NC}"
    echo "  1. Open ${protocol}://${DASHBOARD_DOMAIN} in your browser"
    echo "  2. Complete the setup wizard (create your admin account)"
    echo "  3. Run the install wizard (Settings → Install Mail Services)"
    echo "  4. Add DNS records shown by the install wizard"
    echo ""

    if [ "$protocol" = "http" ]; then
        echo -e "  ${YELLOW}${BOLD}SSL not yet enabled.${NC}"
        echo "  Point your DNS A records to $SERVER_IP, then re-run:"
        echo "    sudo bash $REPO_DIR/setup.sh"
        echo ""
    fi

    echo -e "  ${BOLD}Reminders:${NC}"
    echo "  - Set PTR (reverse DNS) for $SERVER_IP → $MAIL_DOMAIN at your hosting provider"
    echo "  - Ensure outbound port 25 is not blocked (required for sending email)"
    echo "  - Re-run this script anytime to update or enable SSL"
    echo ""
    echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

main() {
    banner
    preflight
    load_config

    # Track first-run before save_config creates the file
    local is_first_run=true
    [ -f "$CONF_FILE" ] && is_first_run=false

    gather_inputs
    detect_web_server
    save_config
    setup_system "$is_first_run"
    setup_firewall
    install_dependencies
    setup_database
    setup_repo
    deploy_dashboard
    setup_ssl
    print_summary
}

main "$@"
