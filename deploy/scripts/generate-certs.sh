#!/usr/bin/env bash
#
# CeyMail Mission Control - TLS Certificate Generator
#
# Generates a full mTLS certificate chain:
#   1. CA key + self-signed CA certificate
#   2. Server key + certificate signed by CA
#   3. Client key + certificate signed by CA (for mTLS)
#
# All artifacts are stored in /etc/ceymail-mc/certs/ and owned by ceymail-mc.
#
# Usage: sudo ./generate-certs.sh [--force]
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MC_USER="ceymail-mc"
MC_GROUP="ceymail-mc"
CERTS_DIR="/etc/ceymail-mc/certs"
DAYS_CA=3650        # CA valid for 10 years
DAYS_SERVER=825     # Server cert valid for ~2.25 years (Apple limit)
DAYS_CLIENT=825     # Client cert valid for ~2.25 years
KEY_SIZE=4096
HOSTNAME="$(hostname -f 2>/dev/null || hostname)"

FORCE=false

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
info()  { printf "\033[1;34m[INFO]\033[0m  %s\n" "$*"; }
warn()  { printf "\033[1;33m[WARN]\033[0m  %s\n" "$*"; }
error() { printf "\033[1;31m[ERROR]\033[0m %s\n" "$*" >&2; }
fatal() { error "$@"; exit 1; }

cleanup_on_error() {
    error "Certificate generation failed. Cleaning up partial files..."
    rm -f "${CERTS_DIR}/ca.key" "${CERTS_DIR}/ca.crt" "${CERTS_DIR}/ca.srl"
    rm -f "${CERTS_DIR}/server.key" "${CERTS_DIR}/server.csr" "${CERTS_DIR}/server.crt"
    rm -f "${CERTS_DIR}/client.key" "${CERTS_DIR}/client.csr" "${CERTS_DIR}/client.crt"
    rm -f "${CERTS_DIR}/server-ext.cnf" "${CERTS_DIR}/client-ext.cnf"
    exit 1
}
trap cleanup_on_error ERR

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=true ;;
        --help|-h)
            echo "Usage: sudo $0 [--force]"
            echo ""
            echo "Options:"
            echo "  --force   Overwrite existing certificates"
            echo "  -h, --help  Show this help message"
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
if [[ $EUID -ne 0 ]]; then
    fatal "This script must be run as root (use sudo)"
fi

if ! command -v openssl &>/dev/null; then
    fatal "openssl is required but not found"
fi

if ! id "${MC_USER}" &>/dev/null; then
    fatal "System user '${MC_USER}' does not exist. Run install-mission-control.sh first."
fi

# Check for existing certificates
if [[ "$FORCE" == false && -f "${CERTS_DIR}/ca.crt" ]]; then
    fatal "Certificates already exist in ${CERTS_DIR}. Use --force to overwrite."
fi

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
info "Generating mTLS certificate chain in ${CERTS_DIR}..."

mkdir -p "${CERTS_DIR}"
cd "${CERTS_DIR}"

# ---------------------------------------------------------------------------
# Step 1: Generate CA key and self-signed certificate
# ---------------------------------------------------------------------------
info "Generating CA private key (${KEY_SIZE}-bit RSA)..."
openssl genrsa -out ca.key ${KEY_SIZE} 2>/dev/null

info "Generating self-signed CA certificate (valid for ${DAYS_CA} days)..."
openssl req -new -x509 \
    -key ca.key \
    -out ca.crt \
    -days ${DAYS_CA} \
    -subj "/C=LK/ST=Western/L=Colombo/O=CeyMail/OU=Mission Control CA/CN=CeyMail MC Root CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"

info "CA certificate generated: ca.crt"

# ---------------------------------------------------------------------------
# Step 2: Generate server key and certificate signed by CA
# ---------------------------------------------------------------------------
info "Generating server private key (${KEY_SIZE}-bit RSA)..."
openssl genrsa -out server.key ${KEY_SIZE} 2>/dev/null

info "Generating server certificate signing request..."
openssl req -new \
    -key server.key \
    -out server.csr \
    -subj "/C=LK/ST=Western/L=Colombo/O=CeyMail/OU=Mission Control/CN=${HOSTNAME}"

# Create extensions file for server cert
cat > server-ext.cnf <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=@alt_names

[alt_names]
DNS.1 = ${HOSTNAME}
DNS.2 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

info "Signing server certificate with CA (valid for ${DAYS_SERVER} days)..."
openssl x509 -req \
    -in server.csr \
    -CA ca.crt \
    -CAkey ca.key \
    -CAcreateserial \
    -out server.crt \
    -days ${DAYS_SERVER} \
    -extfile server-ext.cnf 2>/dev/null

info "Server certificate generated: server.crt"

# ---------------------------------------------------------------------------
# Step 3: Generate client key and certificate signed by CA (for mTLS)
# ---------------------------------------------------------------------------
info "Generating client private key (${KEY_SIZE}-bit RSA)..."
openssl genrsa -out client.key ${KEY_SIZE} 2>/dev/null

info "Generating client certificate signing request..."
openssl req -new \
    -key client.key \
    -out client.csr \
    -subj "/C=LK/ST=Western/L=Colombo/O=CeyMail/OU=Mission Control Client/CN=mc-client"

# Create extensions file for client cert
cat > client-ext.cnf <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
EOF

info "Signing client certificate with CA (valid for ${DAYS_CLIENT} days)..."
openssl x509 -req \
    -in client.csr \
    -CA ca.crt \
    -CAkey ca.key \
    -CAcreateserial \
    -out client.crt \
    -days ${DAYS_CLIENT} \
    -extfile client-ext.cnf 2>/dev/null

info "Client certificate generated: client.crt"

# ---------------------------------------------------------------------------
# Cleanup temporary files
# ---------------------------------------------------------------------------
rm -f server.csr client.csr server-ext.cnf client-ext.cnf ca.srl

# ---------------------------------------------------------------------------
# Set ownership and permissions
# ---------------------------------------------------------------------------
info "Setting ownership and permissions..."

# All files owned by ceymail-mc
chown "${MC_USER}:${MC_GROUP}" ca.key ca.crt server.key server.crt client.key client.crt

# Private keys: owner read only (600)
chmod 600 ca.key server.key client.key

# Certificates: owner read-write, group/others read (644)
chmod 644 ca.crt server.crt client.crt

# Certs directory: only accessible by owner and group
chmod 700 "${CERTS_DIR}"

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
info "Verifying certificate chain..."

openssl verify -CAfile ca.crt server.crt
openssl verify -CAfile ca.crt client.crt

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
echo "  CeyMail Mission Control - Certificates Generated"
echo "============================================================"
echo ""
echo "  Directory:     ${CERTS_DIR}"
echo ""
echo "  CA:"
echo "    Certificate: ${CERTS_DIR}/ca.crt"
echo "    Private Key: ${CERTS_DIR}/ca.key"
echo ""
echo "  Server:"
echo "    Certificate: ${CERTS_DIR}/server.crt"
echo "    Private Key: ${CERTS_DIR}/server.key"
echo "    SANs:        ${HOSTNAME}, localhost, 127.0.0.1, ::1"
echo ""
echo "  Client (mTLS):"
echo "    Certificate: ${CERTS_DIR}/client.crt"
echo "    Private Key: ${CERTS_DIR}/client.key"
echo ""
echo "  Key size:  ${KEY_SIZE}-bit RSA"
echo "  CA valid:  ${DAYS_CA} days"
echo "  Certs valid: ${DAYS_SERVER} days"
echo ""
echo "  IMPORTANT: These are self-signed certificates intended"
echo "  for development and internal use. For production, use"
echo "  certificates from a trusted CA or Let's Encrypt."
echo ""
echo "============================================================"
