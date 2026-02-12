# Deploying CeyMail Mission Control

## Quick Start

SSH into a fresh Ubuntu 22.04 or 24.04 server and run:

```bash
wget -qO- https://raw.githubusercontent.com/derricksiawor/ceymail-mission-control/main/setup.sh | sudo bash
```

The script asks 3 questions (mail domain, dashboard subdomain, certbot email), then installs everything automatically. When it finishes, open the dashboard URL in your browser to complete setup.

### What the Script Does

1. Verifies system requirements (Ubuntu 22.04/24.04, root, 512MB+ RAM)
2. Detects existing web server (Apache or Nginx) or installs Nginx
3. Installs Node.js 22, MariaDB, Certbot, and git
4. Clones the repository to `/opt/mission-control`
5. Builds and deploys the dashboard (systemd service, sudoers, polkit)
6. Generates reverse proxy config (Nginx or Apache) with rate limiting and security headers
7. Obtains SSL certificates via Let's Encrypt (if DNS is already pointing to the server)
8. Prints the dashboard URL and next steps

The script is **idempotent** - safe to re-run. Config is saved to `/etc/ceymail.conf` so re-runs pre-fill previous values as defaults (press Enter to accept). Re-running also enables SSL if DNS has been updated since the first run.

### After the Script

1. Open the dashboard URL shown at the end
2. Complete the setup wizard (database provisioning + admin account creation)
3. Run the install wizard from the dashboard (installs Postfix, Dovecot, OpenDKIM, SpamAssassin, Roundcube)
4. Add the DNS records shown by the install wizard at your domain registrar
5. Set the PTR (reverse DNS) record for your server IP at your hosting provider
6. Ensure outbound port 25 is not blocked (required for sending email)

---

## Prerequisites

- **Ubuntu 22.04 or 24.04 LTS** server with root access
- A **domain name** (e.g., `ceymail.com`)
- DNS A records pointing the domain and dashboard subdomain to the server IP
- **Port 25 unblocked** by your hosting provider (DigitalOcean blocks port 25 by default on new accounts)

---

## Supported Web Servers

The setup script auto-detects the web server:

| Scenario | Action |
|----------|--------|
| Apache running, no Nginx | Uses Apache (enables mod_proxy, mod_ssl, etc.) |
| Nginx running, no Apache | Uses Nginx |
| Both running | Uses Nginx (preferred) |
| Neither installed | Installs Nginx |

Both Nginx and Apache are fully supported throughout the dashboard and install wizard, including webmail (Roundcube) setup.

---

## Subsequent Deploys

After initial setup, deploy code updates with:

```bash
cd /opt/mission-control
sudo bash deploy/scripts/deploy-dashboard.sh
```

This pulls latest code, builds, preserves config across builds, and restarts the service.

---

## DNS Records

After the install wizard completes, add these records at your domain registrar:

| Type | Name | Value |
|------|------|-------|
| A | `mail.yourdomain.com` | Your server IP |
| MX | `yourdomain.com` | `mail.yourdomain.com` (priority 10) |
| TXT | `yourdomain.com` | `v=spf1 mx a:mail.yourdomain.com ~all` |
| TXT | `mail._domainkey.yourdomain.com` | DKIM public key (from install wizard) |
| TXT | `_dmarc.yourdomain.com` | `v=DMARC1; p=none; rua=mailto:you@yourdomain.com` |

Start with DMARC `p=none` while building domain reputation. After 30 days of positive sending, upgrade to `p=quarantine`, then `p=reject`.

---

## Useful Commands

```bash
# Dashboard
systemctl status ceymail-dashboard
journalctl -u ceymail-dashboard -f

# Mail services
systemctl status postfix dovecot opendkim spamassassin

# Mail queue
postqueue -p

# SSL certificates
certbot certificates
certbot renew --dry-run

# Test SMTP/IMAP
openssl s_client -connect yourdomain.com:25 -starttls smtp
openssl s_client -connect yourdomain.com:993
```

---

## File Locations

| Path | Purpose |
|------|---------|
| `/opt/mission-control/` | Git repository |
| `/opt/mission-control/apps/dashboard/.next/standalone/` | Running Next.js build |
| `/opt/mission-control/apps/dashboard/.next/standalone/data/config.json` | Runtime config |
| `/var/lib/ceymail-mc/` | Persistent data (config backups) |
| `/etc/ceymail.conf` | Bootstrap script config (domain, web server) |
| `/etc/sudoers.d/ceymail-mc` | Sudo rules for dashboard |
| `/etc/systemd/system/ceymail-dashboard.service` | Dashboard systemd unit |
| `/etc/letsencrypt/live/` | SSL certificates |
| `/etc/postfix/` | Postfix configuration |
| `/etc/dovecot/` | Dovecot configuration |
| `/etc/opendkim/` | OpenDKIM configuration and keys |

---

## Troubleshooting

**Dashboard won't start**
```bash
journalctl -u ceymail-dashboard -n 50 --no-pager
```

**502 Bad Gateway**
Dashboard isn't running or not listening on port 3000.
```bash
systemctl restart ceymail-dashboard
curl -I http://127.0.0.1:3000
```

**SSL not enabled after setup**
DNS wasn't pointing to the server during initial run. Update DNS, then re-run:
```bash
sudo bash /opt/mission-control/setup.sh
```

**Can't send email (port 25 blocked)**
Cloud providers block port 25 by default. Contact your provider to request unblocking.

**Email lands in spam**
Normal for new mail servers. Verify SPF/DKIM/DMARC pass in email headers, start with DMARC `p=none`, and warm up the domain by sending to known contacts who will reply.

**Factory reset**
In the dashboard: Settings > About > Danger Zone > Factory Reset. This drops databases, deletes config, and restarts. The app returns to the setup wizard.

---

## Manual Installation

<details>
<summary>Click to expand step-by-step manual installation</summary>

If you prefer to install manually instead of using the setup script:

### 1. System Setup

```bash
ssh root@YOUR_SERVER_IP
apt update && apt upgrade -y
hostnamectl set-hostname yourdomain.com
```

### 2. Firewall

```bash
ufw allow OpenSSH
ufw allow 25/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 587/tcp
ufw allow 993/tcp
ufw enable
```

### 3. Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
```

### 4. Web Server

```bash
apt install -y nginx
systemctl enable nginx && systemctl start nginx
```

### 5. MariaDB

```bash
apt install -y mariadb-server
systemctl enable mariadb && systemctl start mariadb
```

### 6. Clone and Deploy

```bash
git clone https://github.com/derricksiawor/ceymail-mission-control.git /opt/mission-control
cd /opt/mission-control
bash deploy/scripts/deploy-dashboard.sh --initial
```

### 7. Reverse Proxy

Create an Nginx config at `/etc/nginx/sites-available/mc.yourdomain.com` that proxies to `127.0.0.1:3000`, enable it, and reload Nginx.

### 8. SSL

```bash
apt install -y certbot python3-certbot-nginx
certbot certonly --nginx -d mc.yourdomain.com --non-interactive --agree-tos -m you@yourdomain.com
certbot certonly --nginx -d yourdomain.com --non-interactive --agree-tos -m you@yourdomain.com
```

Update the Nginx config with SSL paths and reload.

### 9. Complete Setup

Open `https://mc.yourdomain.com` in your browser and follow the setup wizard, then the install wizard.

</details>
