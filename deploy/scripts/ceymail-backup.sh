#!/bin/bash
set -euo pipefail

# ceymail-backup - Restricted backup archive creator
# Only creates tar archives in /var/backups/ceymail/ from allowed source paths.
# Invoked via sudo by the ceymail-mc service user.
# Security boundary: this script validates all paths before passing to tar.

BACKUP_DIR="/var/backups/ceymail"

# Allowed source directories (must match exactly or be a child path).
# The trailing / is enforced during comparison to prevent prefix confusion
# (e.g. /etc/postfixBad must NOT match /etc/postfix).
ALLOWED_DIRS=(
    "/etc/postfix"
    "/etc/dovecot"
    "/etc/spamassassin"
    "/etc/apache2/sites-available"
    "/etc/opendkim"
    "/var/mail/vhosts"
)

# Allowed file prefix (for temp DB dump files — matched as a string prefix
# because the filename is variable: .tmp-dbdump-YYYYMMDDHHMMSS.sql)
ALLOWED_FILE_PREFIX="/var/backups/ceymail/.tmp-dbdump-"

if [ $# -lt 2 ]; then
    echo "Usage: ceymail-backup <output.tar.gz> <path> [path ...]" >&2
    exit 1
fi

OUTPUT="$1"
shift

# Validate output path: must resolve under BACKUP_DIR and end with .tar.gz
REAL_OUTPUT="$(realpath -m "$OUTPUT")"
if [[ "$REAL_OUTPUT" != "$BACKUP_DIR/"* ]] || [[ "$REAL_OUTPUT" != *.tar.gz ]]; then
    echo "Error: output must be ${BACKUP_DIR}/*.tar.gz" >&2
    exit 1
fi

# Validate each source path against the allowlist.
# Directory entries must match exactly or be a child (with / separator).
# The file prefix is matched as a string prefix for temp dump files.
for src in "$@"; do
    REAL_SRC="$(realpath -m "$src")"
    allowed=false

    # Check directory allowlist (exact match or child path)
    for dir in "${ALLOWED_DIRS[@]}"; do
        if [[ "$REAL_SRC" == "$dir" ]] || [[ "$REAL_SRC" == "$dir/"* ]]; then
            allowed=true
            break
        fi
    done

    # Check file prefix allowlist (temp DB dump — must end with .sql)
    if [ "$allowed" = false ] && [[ "$REAL_SRC" == "$ALLOWED_FILE_PREFIX"*.sql ]]; then
        allowed=true
    fi

    if [ "$allowed" = false ]; then
        echo "Error: source path not allowed: $src" >&2
        exit 1
    fi
done

# GNU tar stores symlinks as symlinks by default (does NOT follow them),
# preventing exfiltration of arbitrary files via a planted symlink inside
# an allowed directory. No extra flags needed — this is the default.
exec /usr/bin/tar czf "$OUTPUT" "$@"
