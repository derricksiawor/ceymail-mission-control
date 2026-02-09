# CeyMail Mission Control — Server Deployment Prompt

> Give this prompt to an AI model with SSH access to the server.

---

## Prompt

You are deploying **CeyMail Mission Control** — a mail server administration platform — on a fresh Ubuntu 22.04 server. The platform has two components: a **Rust gRPC backend** and a **Next.js 15 dashboard frontend**. After deployment, the dashboard's built-in install wizard handles installing and configuring all mail services (Postfix, Dovecot, OpenDKIM, SpamAssassin, etc.) through the browser.

### Server Details

| Field | Value |
|-------|-------|
| IP | `159.203.78.131` |
| Domain | `ceymail.com` |
| Hostname | `mc.ceymail.com` |
| OS | Ubuntu 22.04 LTS |
| Provider | DigitalOcean |

### DNS Records (already configured)

| Type | Name | Value | Notes |
|------|------|-------|-------|
| A | `ceymail.com` | `159.203.78.131` | Root domain |
| A | `mc` | `159.203.78.131` | Dashboard subdomain |
| CNAME | `www` | `ceymail.com` | WWW redirect |
| MX | `ceymail.com` | `ceymail.com` | Priority 10 |
| TXT | `ceymail.com` | `"v=spf1 mx -all"` | SPF record |
| TXT | `_dmarc` | `"v=DMARC1; p=quarantine;"` | DMARC policy |

### What You Need To Do

Deploy the platform so that:
- The dashboard is accessible at `https://mc.ceymail.com` (Nginx reverse proxy + Let's Encrypt SSL)
- The Rust gRPC backend runs as a systemd service on `127.0.0.1:50051`
- MariaDB is installed and running (the dashboard's first-run wizard handles DB/table creation)
- After deployment, the user visits `https://mc.ceymail.com` and completes the setup wizard in-browser
- The dashboard's install wizard (accessible after first-run setup) handles all mail service installation

---

## Step-by-Step Deployment

### Phase 1: System Preparation

```bash
# Set hostname
hostnamectl set-hostname mc.ceymail.com

# Update system
apt update && apt upgrade -y

# Install base dependencies
apt install -y \
  build-essential \
  pkg-config \
  libssl-dev \
  curl \
  git \
  nginx \
  certbot \
  python3-certbot-nginx \
  mariadb-server \
  mariadb-client

# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Install Node.js 20 LTS (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify versions
rustc --version    # Should be 1.75+
node --version     # Should be 20.x
npm --version      # Should be 10.x
nginx -v
mariadb --version
```

### Phase 2: MariaDB Setup

```bash
# Secure MariaDB installation
mysql_secure_installation
# Answer: Switch to unix_socket auth? N
# Set root password? Y -> set a strong root password
# Remove anonymous users? Y
# Disallow root login remotely? Y
# Remove test database? Y
# Reload privilege tables? Y

# Enable both password and unix_socket auth for root
# (The dashboard's first-run wizard needs password auth to create the ceymail DB user)
sudo mysql -e "ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD('YOUR_MARIADB_ROOT_PASSWORD') OR unix_socket;"
sudo mysql -e "FLUSH PRIVILEGES;"

# Verify password auth works
mysql -u root -p'YOUR_MARIADB_ROOT_PASSWORD' -e "SELECT VERSION();"
```

**Important:** Remember this root password — you'll enter it once in the browser wizard. The wizard creates a dedicated `ceymail` DB user and never stores the root password.

### Phase 3: Clone and Build the Project

```bash
# Clone the repository (adjust URL to your actual repo location)
cd /opt
git clone <YOUR_REPO_URL> mission-control
cd /opt/mission-control

# --- Build the Rust backend ---
cargo build --release -p mc-daemon
# Binary will be at: target/release/mc-daemon

# Copy binary to system path
cp target/release/mc-daemon /usr/local/bin/mc-daemon
chmod 755 /usr/local/bin/mc-daemon

# --- Build the Next.js dashboard ---
cd /opt/mission-control/apps/dashboard
npm install
npm run build
# Standalone output will be at: .next/standalone/
```

### Phase 4: Create System User and Directories

```bash
# Create dedicated system user
useradd --system --shell /usr/sbin/nologin --home-dir /var/lib/ceymail-mc ceymail-mc
mkdir -p /var/lib/ceymail-mc
mkdir -p /var/log/ceymail-mc
mkdir -p /etc/ceymail-mc/certs

# Install the dashboard to its production location
cp -r /opt/mission-control/apps/dashboard/.next/standalone /var/lib/ceymail-mc/dashboard
cp -r /opt/mission-control/apps/dashboard/.next/static /var/lib/ceymail-mc/dashboard/.next/static
cp -r /opt/mission-control/apps/dashboard/public /var/lib/ceymail-mc/dashboard/public

# Create the data directory for runtime config (first-run wizard writes here)
mkdir -p /var/lib/ceymail-mc/dashboard/data

# Set ownership
chown -R ceymail-mc:ceymail-mc /var/lib/ceymail-mc
chown -R ceymail-mc:ceymail-mc /var/log/ceymail-mc
chown -R ceymail-mc:ceymail-mc /etc/ceymail-mc
```

### Phase 5: Systemd Services

#### Rust gRPC Backend Service

```bash
# Install the systemd unit from the repo
cp /opt/mission-control/deploy/systemd/ceymail-mc.service /etc/systemd/system/

# Install polkit policy (needed for mail service management)
cp /opt/mission-control/deploy/polkit/com.ceymail.mc.policy /usr/share/polkit-1/actions/

# Generate TLS certificates for gRPC mTLS
/opt/mission-control/deploy/scripts/generate-certs.sh
# Or manually generate self-signed certs:
# openssl req -x509 -newkey rsa:4096 -keyout /etc/ceymail-mc/certs/server.key \
#   -out /etc/ceymail-mc/certs/server.crt -days 825 -nodes \
#   -subj "/CN=mc.ceymail.com"

# Create backend config
cat > /etc/ceymail-mc/config.toml << 'EOF'
[server]
listen_address = "127.0.0.1"
grpc_port = 50051
dashboard_port = 8443

[tls]
cert_path = "/etc/ceymail-mc/certs/server.crt"
key_path = "/etc/ceymail-mc/certs/server.key"
ca_path = "/etc/ceymail-mc/certs/ca.crt"
client_auth = true

[database]
path = "/var/lib/ceymail-mc/mission-control.db"

[backups]
directory = "/var/lib/ceymail-mc/backups"
max_count = 10

[logging]
level = "info"
EOF

chown ceymail-mc:ceymail-mc /etc/ceymail-mc/config.toml
chmod 640 /etc/ceymail-mc/config.toml

# Enable and start the gRPC backend
systemctl daemon-reload
systemctl enable ceymail-mc
systemctl start ceymail-mc
systemctl status ceymail-mc
```

#### Next.js Dashboard Service

```bash
cat > /etc/systemd/system/ceymail-dashboard.service << 'EOF'
[Unit]
Description=CeyMail Dashboard (Next.js)
After=network.target mariadb.service
Wants=mariadb.service

[Service]
Type=simple
User=ceymail-mc
Group=ceymail-mc
WorkingDirectory=/var/lib/ceymail-mc/dashboard
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

# Environment
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/ceymail-mc/dashboard/data
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ceymail-dashboard
systemctl start ceymail-dashboard
systemctl status ceymail-dashboard
```

### Phase 6: Nginx Reverse Proxy + SSL

```bash
# Create Nginx site config
cat > /etc/nginx/sites-available/ceymail-dashboard << 'NGINX'
server {
    listen 80;
    server_name mc.ceymail.com;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all HTTP to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name mc.ceymail.com;

    # SSL certificates (will be filled by certbot)
    ssl_certificate /etc/letsencrypt/live/mc.ceymail.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mc.ceymail.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_stapling on;
    ssl_stapling_verify on;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Proxy to Next.js dashboard
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # gRPC proxy (for gRPC-web from browser)
    location /api/grpc/ {
        grpc_pass grpcs://127.0.0.1:50051;
        grpc_ssl_verify off;
    }
}
NGINX

# Enable the site
ln -sf /etc/nginx/sites-available/ceymail-dashboard /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Get SSL certificate FIRST (before enabling the HTTPS server block)
# Temporarily use only the HTTP block:
cat > /etc/nginx/sites-available/ceymail-dashboard-temp << 'NGINX'
server {
    listen 80;
    server_name mc.ceymail.com;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 200 'CeyMail setup in progress'; }
}
NGINX
ln -sf /etc/nginx/sites-available/ceymail-dashboard-temp /etc/nginx/sites-enabled/ceymail-dashboard
nginx -t && systemctl reload nginx

# Obtain Let's Encrypt certificate
certbot certonly --nginx -d mc.ceymail.com --non-interactive --agree-tos --email admin@ceymail.com --no-eff-email

# Now switch to the full config with SSL
ln -sf /etc/nginx/sites-available/ceymail-dashboard /etc/nginx/sites-enabled/ceymail-dashboard
rm -f /etc/nginx/sites-available/ceymail-dashboard-temp
nginx -t && systemctl reload nginx

# Enable auto-renewal
systemctl enable certbot.timer
```

### Phase 7: Firewall Configuration

```bash
# Install and configure UFW
apt install -y ufw

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow 22/tcp

# Allow HTTP/HTTPS (dashboard + Let's Encrypt)
ufw allow 80/tcp
ufw allow 443/tcp

# Allow mail ports
ufw allow 25/tcp     # SMTP
ufw allow 587/tcp    # SMTP submission (STARTTLS)
ufw allow 465/tcp    # SMTPS (implicit TLS)
ufw allow 993/tcp    # IMAPS
ufw allow 143/tcp    # IMAP (STARTTLS)

# Enable firewall
ufw enable
ufw status verbose
```

### Phase 8: Verify Deployment

```bash
# Check all services are running
systemctl status mariadb
systemctl status ceymail-mc
systemctl status ceymail-dashboard
systemctl status nginx

# Test the dashboard is reachable
curl -I https://mc.ceymail.com

# Check logs if anything is wrong
journalctl -u ceymail-dashboard -f
journalctl -u ceymail-mc -f
```

---

## Post-Deployment: Browser Setup

After deployment, open **https://mc.ceymail.com** in a browser. You will be redirected to the **first-run setup wizard** at `/welcome`:

### First-Run Wizard (4 steps)

1. **Welcome** — Click "Get Started"
2. **Database Setup** — Enter:
   - Host: `localhost`, Port: `3306`
   - Root user: `root`, Root password: `YOUR_MARIADB_ROOT_PASSWORD`
   - CeyMail user: `ceymail` (password auto-generated)
   - Click "Test Connection" then "Set Up Database"
   - The wizard creates both databases (`ceymail`, `ceymail_dashboard`), all tables, and the `ceymail` DB user
3. **Admin Account** — Create your dashboard admin (username, email, password)
4. **Complete** — Auto-redirects to dashboard with active session

### Mail Server Install Wizard (10 steps)

After the first-run wizard, navigate to the **Install** page in the dashboard sidebar. This wizard installs and configures all mail services:

1. **System Check** — Validates OS, RAM (1GB+), disk (10GB+), CPU
2. **PHP Version** — Select PHP version (8.2 recommended)
3. **Core Packages** — Installs: Postfix, Dovecot, OpenDKIM, SpamAssassin, Apache2, Unbound, Rsyslog, PHP + modules
4. **Domain Config** — Enter hostname (`mc.ceymail.com`), mail domain (`ceymail.com`), admin email
5. **SSL Certificates** — Generates Let's Encrypt certs for the mail hostname via Certbot
6. **Service Configuration** — Generates and writes config files for Postfix, Dovecot, OpenDKIM, SpamAssassin (review before applying)
7. **DKIM Setup** — Generates 2048-bit DKIM keys for `ceymail.com`
8. **Permissions** — Creates `vmail` user (UID 5000), sets file ownership/permissions
9. **Enable Services** — Starts and enables all mail systemd services
10. **Summary** — Shows DNS records to add (DKIM TXT record)

### Post-Install DNS Record

After Step 7, the wizard will display a **DKIM TXT record** to add to Cloudflare DNS:

| Type | Name | Value |
|------|------|-------|
| TXT | `mail._domainkey.ceymail.com` | `v=DKIM1; k=rsa; p=<PUBLIC_KEY>` |

Add this record in Cloudflare to complete DKIM setup.

---

## Architecture Summary

```
Internet
  │
  ├─ HTTPS (443) ──► Nginx ──► Next.js Dashboard (127.0.0.1:3000)
  │                    │
  │                    └──► gRPC Backend (127.0.0.1:50051)
  │
  ├─ SMTP (25/587/465) ──► Postfix
  │                          │
  │                          └──► Dovecot (LMTP) ──► /var/mail/vhosts/
  │
  ├─ IMAP (993/143) ──► Dovecot
  │
  └─ DNS queries ──► Unbound (local resolver)

MariaDB (localhost:3306)
  ├─ ceymail DB ──► Postfix/Dovecot virtual domains/users/aliases
  └─ ceymail_dashboard DB ──► Dashboard users, audit logs, install state
```

---

## Important Notes

- The **root DB password is only used once** during the first-run wizard and is never stored
- The wizard generates a `data/config.json` file with the `ceymail` user credentials (mode 0o600)
- Session tokens use HMAC-SHA256 (not JWT) with a 256-bit random secret
- All API routes use prepared statements (no SQL injection risk)
- The dashboard runs as the `ceymail-mc` system user with minimal privileges
- The install wizard requires **root-level access** to install packages and configure services — ensure the `ceymail-mc` user has the necessary polkit policies installed, or run the dashboard process with appropriate sudo/polkit permissions for the install phase
- If the gRPC backend is not needed immediately, you can skip Phase 5's Rust service and just deploy the dashboard — it works standalone for DB management
