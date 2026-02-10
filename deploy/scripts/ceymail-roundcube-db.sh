#!/bin/bash
# CeyMail Mission Control — hardened Roundcube database setup wrapper
# Only allows specific database operations on the 'roundcube' database.
# Install: cp deploy/scripts/ceymail-roundcube-db.sh /usr/local/bin/ceymail-roundcube-db && chmod 755 /usr/local/bin/ceymail-roundcube-db
set -euo pipefail

DB_NAME="roundcube"
DB_USER="roundcube"

case "${1:-}" in
  create-db)
    /usr/bin/mysql <<EOSQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EOSQL
    ;;
  setup-user)
    # Read password from stdin (single line, alphanumeric only)
    read -r PASSWORD
    if [[ ! "${PASSWORD}" =~ ^[A-Za-z0-9]+$ ]]; then
      echo "ERROR: Invalid password format" >&2
      exit 1
    fi
    /usr/bin/mysql <<EOSQL
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
EOSQL
    ;;
  import-schema)
    SCHEMA="/usr/share/roundcube/SQL/mysql.initial.sql"
    if [ ! -f "${SCHEMA}" ]; then
      echo "ERROR: Schema file not found: ${SCHEMA}" >&2
      exit 1
    fi
    # Check if schema already exists (users table is core Roundcube table)
    TABLE_COUNT=$(/usr/bin/mysql -sN -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${DB_NAME}' AND table_name='users'" 2>/dev/null || echo "0")
    if [ "${TABLE_COUNT}" -gt 0 ]; then
      echo "Schema already initialized"
      exit 0
    fi
    /usr/bin/mysql "${DB_NAME}" < "${SCHEMA}"
    ;;
  *)
    echo "Usage: $0 {create-db|setup-user|import-schema}" >&2
    exit 1
    ;;
esac
