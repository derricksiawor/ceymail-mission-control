#!/usr/bin/env bash
#
# CeyMail Mission Control - Installation Script
#
# This script installs and configures the CeyMail Mission Control daemon,
# dashboard, systemd service, and polkit policy on a target system.
#
# Usage: sudo ./install-mission-control.sh [--skip-dashboard] [--skip-certs]
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MC_USER="ceymail-mc"
MC_GROUP="ceymail-mc"
MC_CONFIG_DIR="/etc/ceymail-mc"
MC_STATE_DIR="/var/lib/ceymail-mc"
MC_BACKUP_DIR="/var/lib/ceymail-mc/backups"
MC_DASHBOARD_DIR="/var/lib/ceymail-mc/dashboard"
MC_CERTS_DIR="/etc/ceymail-mc/certs"
MC_LOG_DIR="/var/log/ceymail-mc"
MC_BINARY="/usr/local/bin/mc-daemon"
SYSTEMD_UNIT="/etc/systemd/system/ceymail-mc.service"
POLKIT_POLICY="/usr/share/polkit-1/actions/com.ceymail.mc.policy"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SKIP_DASHBOARD=false
SKIP_CERTS=false
DEFAULT_PORT=8443

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf "\033[1;34m[INFO]\033[0m  %s\n" "$*"; }
warn()  { printf "\033[1;33m[WARN]\033[0m  %s\n" "$*"; }
error() { printf "\033[1;31m[ERROR]\033[0m %s\n" "$*" >&2; }
fatal() { error "$@"; exit 1; }

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
    case "$arg" in
        --skip-dashboard) SKIP_DASHBOARD=true ;;
        --skip-certs)     SKIP_CERTS=true ;;
        --help|-h)
            echo "Usage: sudo $0 [--skip-dashboard] [--skip-certs]"
            echo ""
            echo "Options:"
            echo "  --skip-dashboard   Skip building and installing the Next.js dashboard"
            echo "  --skip-certs       Skip generating self-signed TLS certificates"
            echo "  -h, --help         Show this help message"
            exit 0
            ;;
        *)
            fatal "Unknown argument: $arg"
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
info "Running pre-flight checks..."

if [[ $EUID -ne 0 ]]; then
    fatal "This script must be run as root (use sudo)"
fi

# Verify required tools
for cmd in openssl systemctl install; do
    if ! command -v "$cmd" &>/dev/null; then
        fatal "Required command not found: $cmd"
    fi
done

if [[ "$SKIP_DASHBOARD" == false ]]; then
    for cmd in node npm; do
        if ! command -v "$cmd" &>/dev/null; then
            fatal "Required command not found: $cmd (needed to build the dashboard). Use --skip-dashboard to skip."
        fi
    done
fi

# ---------------------------------------------------------------------------
# Create system user and group
# ---------------------------------------------------------------------------
info "Creating system user and group: ${MC_USER}..."

if ! getent group "${MC_GROUP}" &>/dev/null; then
    groupadd --system "${MC_GROUP}"
    info "Created group: ${MC_GROUP}"
else
    info "Group ${MC_GROUP} already exists"
fi

if ! id "${MC_USER}" &>/dev/null; then
    useradd --system \
        --gid "${MC_GROUP}" \
        --home-dir "${MC_STATE_DIR}" \
        --shell /usr/sbin/nologin \
        --comment "CeyMail Mission Control daemon" \
        "${MC_USER}"
    info "Created user: ${MC_USER}"
else
    info "User ${MC_USER} already exists"
fi

# ---------------------------------------------------------------------------
# Create required directories
# ---------------------------------------------------------------------------
info "Creating required directories..."

declare -a DIRS=(
    "${MC_CONFIG_DIR}"
    "${MC_CERTS_DIR}"
    "${MC_STATE_DIR}"
    "${MC_BACKUP_DIR}"
    "${MC_DASHBOARD_DIR}"
    "${MC_LOG_DIR}"
)

for dir in "${DIRS[@]}"; do
    mkdir -p "$dir"
    chown "${MC_USER}:${MC_GROUP}" "$dir"
    info "  ${dir}"
done

chmod 750 "${MC_CONFIG_DIR}"
chmod 700 "${MC_CERTS_DIR}"
chmod 750 "${MC_STATE_DIR}"
chmod 750 "${MC_BACKUP_DIR}"
chmod 755 "${MC_DASHBOARD_DIR}"

# ---------------------------------------------------------------------------
# Install the mc-daemon binary
# ---------------------------------------------------------------------------
info "Installing mc-daemon binary..."

BINARY_SOURCE="${REPO_ROOT}/target/release/mc-daemon"

if [[ ! -f "${BINARY_SOURCE}" ]]; then
    warn "Release binary not found at ${BINARY_SOURCE}"
    info "Attempting to build from source..."

    if ! command -v cargo &>/dev/null; then
        fatal "cargo not found. Please build the binary first: cargo build --release -p mc-daemon"
    fi

    (cd "${REPO_ROOT}" && cargo build --release -p mc-daemon)

    if [[ ! -f "${BINARY_SOURCE}" ]]; then
        fatal "Build failed: binary not found at ${BINARY_SOURCE}"
    fi
fi

install -m 755 -o root -g root "${BINARY_SOURCE}" "${MC_BINARY}"
info "Installed binary to ${MC_BINARY}"

# ---------------------------------------------------------------------------
# Install systemd unit file
# ---------------------------------------------------------------------------
info "Installing systemd unit file..."

UNIT_SOURCE="${REPO_ROOT}/deploy/systemd/ceymail-mc.service"
if [[ ! -f "${UNIT_SOURCE}" ]]; then
    fatal "Systemd unit file not found: ${UNIT_SOURCE}"
fi

install -m 644 -o root -g root "${UNIT_SOURCE}" "${SYSTEMD_UNIT}"
systemctl daemon-reload
info "Installed systemd unit to ${SYSTEMD_UNIT}"

# ---------------------------------------------------------------------------
# Install polkit policy
# ---------------------------------------------------------------------------
info "Installing polkit policy..."

POLKIT_SOURCE="${REPO_ROOT}/deploy/polkit/com.ceymail.mc.policy"
if [[ ! -f "${POLKIT_SOURCE}" ]]; then
    fatal "Polkit policy file not found: ${POLKIT_SOURCE}"
fi

mkdir -p "$(dirname "${POLKIT_POLICY}")"
install -m 644 -o root -g root "${POLKIT_SOURCE}" "${POLKIT_POLICY}"
info "Installed polkit policy to ${POLKIT_POLICY}"

# ---------------------------------------------------------------------------
# Generate self-signed TLS certificates
# ---------------------------------------------------------------------------
if [[ "$SKIP_CERTS" == false ]]; then
    if [[ -f "${MC_CERTS_DIR}/server.crt" && -f "${MC_CERTS_DIR}/server.key" ]]; then
        warn "TLS certificates already exist in ${MC_CERTS_DIR}. Skipping generation."
        warn "To regenerate, remove existing certs or run deploy/scripts/generate-certs.sh"
    else
        info "Generating self-signed TLS certificates..."
        CERT_SCRIPT="${REPO_ROOT}/deploy/scripts/generate-certs.sh"
        if [[ -f "${CERT_SCRIPT}" ]]; then
            bash "${CERT_SCRIPT}"
        else
            warn "Certificate generation script not found: ${CERT_SCRIPT}"
            warn "Generating minimal self-signed certificate..."
            openssl req -x509 -newkey rsa:4096 \
                -keyout "${MC_CERTS_DIR}/server.key" \
                -out "${MC_CERTS_DIR}/server.crt" \
                -days 365 -nodes \
                -subj "/CN=ceymail-mission-control/O=CeyMail/OU=Mission Control"
            chown "${MC_USER}:${MC_GROUP}" "${MC_CERTS_DIR}/server.key" "${MC_CERTS_DIR}/server.crt"
            chmod 600 "${MC_CERTS_DIR}/server.key"
            chmod 644 "${MC_CERTS_DIR}/server.crt"
        fi
        info "TLS certificates installed to ${MC_CERTS_DIR}"
    fi
else
    info "Skipping certificate generation (--skip-certs)"
fi

# ---------------------------------------------------------------------------
# Build and install the Next.js dashboard
# ---------------------------------------------------------------------------
if [[ "$SKIP_DASHBOARD" == false ]]; then
    info "Building Next.js dashboard..."

    DASHBOARD_SOURCE="${REPO_ROOT}/apps/dashboard"
    if [[ ! -d "${DASHBOARD_SOURCE}" ]]; then
        fatal "Dashboard source not found: ${DASHBOARD_SOURCE}"
    fi

    (
        cd "${DASHBOARD_SOURCE}"
        info "Installing Node.js dependencies..."
        npm ci --production=false
        info "Building dashboard..."
        npm run build
    )

    info "Installing dashboard to ${MC_DASHBOARD_DIR}..."

    # Clean previous installation
    rm -rf "${MC_DASHBOARD_DIR:?}/"*

    # Copy the standalone Next.js build
    if [[ -d "${DASHBOARD_SOURCE}/.next/standalone" ]]; then
        cp -r "${DASHBOARD_SOURCE}/.next/standalone/." "${MC_DASHBOARD_DIR}/"
        # Copy static assets
        if [[ -d "${DASHBOARD_SOURCE}/.next/static" ]]; then
            mkdir -p "${MC_DASHBOARD_DIR}/.next/static"
            cp -r "${DASHBOARD_SOURCE}/.next/static/." "${MC_DASHBOARD_DIR}/.next/static/"
        fi
        if [[ -d "${DASHBOARD_SOURCE}/public" ]]; then
            mkdir -p "${MC_DASHBOARD_DIR}/public"
            cp -r "${DASHBOARD_SOURCE}/public/." "${MC_DASHBOARD_DIR}/public/"
        fi
    else
        # Fallback: copy the full .next build output
        cp -r "${DASHBOARD_SOURCE}/.next" "${MC_DASHBOARD_DIR}/"
        cp -r "${DASHBOARD_SOURCE}/node_modules" "${MC_DASHBOARD_DIR}/"
        cp "${DASHBOARD_SOURCE}/package.json" "${MC_DASHBOARD_DIR}/"
        if [[ -d "${DASHBOARD_SOURCE}/public" ]]; then
            cp -r "${DASHBOARD_SOURCE}/public" "${MC_DASHBOARD_DIR}/"
        fi
    fi

    chown -R "${MC_USER}:${MC_GROUP}" "${MC_DASHBOARD_DIR}"
    info "Dashboard installed to ${MC_DASHBOARD_DIR}"
else
    info "Skipping dashboard build (--skip-dashboard)"
fi

# ---------------------------------------------------------------------------
# Create default configuration if it does not exist
# ---------------------------------------------------------------------------
MC_DEFAULT_CONFIG="${MC_CONFIG_DIR}/config.toml"
if [[ ! -f "${MC_DEFAULT_CONFIG}" ]]; then
    info "Creating default configuration file..."
    cat > "${MC_DEFAULT_CONFIG}" <<'TOML'
# CeyMail Mission Control - Configuration
# See https://ceymail.com/docs/mission-control/configuration for details

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
TOML
    chown "${MC_USER}:${MC_GROUP}" "${MC_DEFAULT_CONFIG}"
    chmod 640 "${MC_DEFAULT_CONFIG}"
    info "Default config written to ${MC_DEFAULT_CONFIG}"
fi

# ---------------------------------------------------------------------------
# Enable and start the service
# ---------------------------------------------------------------------------
info "Enabling and starting ceymail-mc service..."

systemctl enable ceymail-mc.service
systemctl start ceymail-mc.service

# Give the service a moment to start
sleep 2

if systemctl is-active --quiet ceymail-mc.service; then
    info "Service is running."
else
    warn "Service may not have started correctly. Check: journalctl -u ceymail-mc.service"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
HOSTNAME="$(hostname -f 2>/dev/null || hostname)"
echo ""
echo "============================================================"
echo "  CeyMail Mission Control - Installation Complete"
echo "============================================================"
echo ""
echo "  Dashboard URL:  https://${HOSTNAME}:${DEFAULT_PORT}"
echo "  gRPC endpoint:  ${HOSTNAME}:50051"
echo ""
echo "  Config file:    ${MC_DEFAULT_CONFIG}"
echo "  Certificates:   ${MC_CERTS_DIR}/"
echo "  Service logs:   journalctl -u ceymail-mc.service -f"
echo ""
echo "  Manage service:"
echo "    systemctl status  ceymail-mc"
echo "    systemctl restart ceymail-mc"
echo "    systemctl stop    ceymail-mc"
echo ""
echo "============================================================"
