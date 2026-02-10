#!/bin/bash
# CeyMail Mission Control — safe Nginx include management for Roundcube webmail
# Only allows specific operations on the Roundcube webmail snippet.
# Install: cp deploy/scripts/ceymail-nginx-webmail.sh /usr/local/bin/ceymail-nginx-webmail && chmod 755 /usr/local/bin/ceymail-nginx-webmail
set -euo pipefail

SNIPPET="/etc/nginx/snippets/roundcube-webmail.conf"
SITES_ENABLED="/etc/nginx/sites-enabled"
SITES_AVAILABLE="/etc/nginx/sites-available"
INCLUDE_LINE="    include ${SNIPPET};"

case "${1:-}" in
  add-include)
    DOMAIN="${2:-}"
    # Validate domain: RFC-compliant labels, 2+ char alpha TLD, max 253 chars
    if [[ -z "${DOMAIN}" ]] || [[ ${#DOMAIN} -gt 253 ]] || \
       [[ ! "${DOMAIN}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$ ]]; then
      echo "ERROR: Invalid or missing domain" >&2
      exit 1
    fi

    # Verify snippet exists before trying to include it
    if [[ ! -f "${SNIPPET}" ]]; then
      echo "ERROR: Snippet file not found: ${SNIPPET}" >&2
      exit 1
    fi

    # Escape dots for grep regex (prevent matching "any character")
    ESCAPED_DOMAIN=$(printf '%s' "${DOMAIN}" | sed 's/\./\\./g')

    # Find the Nginx config file that serves this domain (exact token match —
    # domain must be preceded by whitespace or server_name, followed by whitespace or semicolon)
    CONFIG=""
    for f in "${SITES_ENABLED}"/*; do
      if [[ -f "${f}" ]] && grep -qE "(server_name[[:space:]]+|[[:space:]])${ESCAPED_DOMAIN}([[:space:]]|;)" "${f}" 2>/dev/null; then
        CONFIG="${f}"
        break
      fi
    done

    if [[ -z "${CONFIG}" ]]; then
      echo "ERROR: No Nginx config found for domain: ${DOMAIN}" >&2
      exit 1
    fi

    # Check if already included
    if grep -Fq "roundcube-webmail.conf" "${CONFIG}" 2>/dev/null; then
      echo "Already included in ${CONFIG}"
      exit 0
    fi

    # Resolve symlink to modify the actual file
    REAL_CONFIG="$(readlink -f "${CONFIG}")"

    # Backup before modification; clean up on any exit
    cp "${REAL_CONFIG}" "${REAL_CONFIG}.bak-$$"
    cleanup() { rm -f "${REAL_CONFIG}.tmp-$$" "${REAL_CONFIG}.bak-$$" 2>/dev/null; }
    trap cleanup EXIT

    # Use awk to insert the include line in the correct server block.
    # For HTTPS configs: insert before the first "location" directive that
    # appears AFTER an actual ssl_certificate directive (excludes comments).
    # For plain HTTP configs: insert before the last closing brace.
    if grep -Eq "^[[:space:]]*ssl_certificate[[:space:]]" "${REAL_CONFIG}" 2>/dev/null; then
      # HTTPS config — insert before the first location directive in the SSL block
      if ! awk -v inc="${INCLUDE_LINE}" '
        /^[[:space:]]*ssl_certificate[[:space:]]/ { in_ssl = 1 }
        in_ssl && /^[[:space:]]*location / && !inserted {
          print ""
          print "    # Roundcube webmail at /webmail"
          print inc
          print ""
          inserted = 1
        }
        { print }
        END {
          if (!inserted) {
            print "ERROR: no insertion point found in SSL block" > "/dev/stderr"
            exit 1
          }
        }
      ' "${REAL_CONFIG}" > "${REAL_CONFIG}.tmp-$$"; then
        echo "ERROR: Failed to insert include directive" >&2
        mv "${REAL_CONFIG}.bak-$$" "${REAL_CONFIG}"
        exit 1
      fi
    else
      # Plain HTTP config — insert before the last closing brace
      if ! awk -v inc="${INCLUDE_LINE}" '
        { lines[NR] = $0; count = NR }
        END {
          last_brace = 0
          for (i = count; i >= 1; i--) {
            if (lines[i] ~ /^\}/) { last_brace = i; break }
          }
          if (last_brace == 0) {
            print "ERROR: no closing brace found" > "/dev/stderr"
            exit 1
          }
          for (i = 1; i <= count; i++) {
            if (i == last_brace) {
              print ""
              print "    # Roundcube webmail at /webmail"
              print inc
            }
            print lines[i]
          }
        }
      ' "${REAL_CONFIG}" > "${REAL_CONFIG}.tmp-$$"; then
        echo "ERROR: Failed to insert include directive" >&2
        mv "${REAL_CONFIG}.bak-$$" "${REAL_CONFIG}"
        exit 1
      fi
    fi

    # Atomic replace: move temp file over the original
    if [[ -s "${REAL_CONFIG}.tmp-$$" ]]; then
      mv "${REAL_CONFIG}.tmp-$$" "${REAL_CONFIG}"
    else
      echo "ERROR: awk produced empty output, restoring backup" >&2
      mv "${REAL_CONFIG}.bak-$$" "${REAL_CONFIG}"
      exit 1
    fi

    # Disarm cleanup trap (backup already consumed or cleaned up)
    trap - EXIT
    rm -f "${REAL_CONFIG}.bak-$$"

    echo "Added include to ${REAL_CONFIG}"
    ;;

  remove-include)
    # Remove roundcube-webmail include and comment from all site configs
    ERRORS=0
    for f in "${SITES_ENABLED}"/*; do
      if [[ -f "${f}" ]]; then
        REAL_FILE="$(readlink -f "${f}")"
        if grep -Fq "roundcube-webmail.conf" "${REAL_FILE}" 2>/dev/null; then
          # Backup before modification
          cp "${REAL_FILE}" "${REAL_FILE}.bak-$$"
          # Use awk to remove the comment and include lines, eat trailing blanks,
          # then collapse consecutive blank lines to prevent accumulation
          awk '
            /# Roundcube webmail at \/webmail/ { skip = 1; next }
            /roundcube-webmail\.conf/ { skip = 1; next }
            skip && /^[[:space:]]*$/ { next }
            { skip = 0 }
            /^[[:space:]]*$/ { blank++; if (blank <= 1) print; next }
            { blank = 0; print }
          ' "${REAL_FILE}" > "${REAL_FILE}.tmp-$$"
          if [[ -s "${REAL_FILE}.tmp-$$" ]]; then
            mv "${REAL_FILE}.tmp-$$" "${REAL_FILE}"
            rm -f "${REAL_FILE}.bak-$$"
            echo "Removed include from ${REAL_FILE}"
          else
            echo "ERROR: awk produced empty output during remove-include, restoring backup" >&2
            mv "${REAL_FILE}.bak-$$" "${REAL_FILE}"
            rm -f "${REAL_FILE}.tmp-$$"
            ERRORS=$((ERRORS + 1))
          fi
        fi
      fi
    done
    if [[ "${ERRORS}" -gt 0 ]]; then
      exit 1
    fi
    ;;

  cleanup-legacy)
    # Remove old standalone Roundcube server block (pre-/webmail migration)
    REMOVED=false
    if [[ -L "${SITES_ENABLED}/roundcube" ]] || [[ -f "${SITES_ENABLED}/roundcube" ]]; then
      rm -f "${SITES_ENABLED}/roundcube"
      echo "Removed ${SITES_ENABLED}/roundcube"
      REMOVED=true
    fi
    if [[ -f "${SITES_AVAILABLE}/roundcube" ]]; then
      rm -f "${SITES_AVAILABLE}/roundcube"
      echo "Removed ${SITES_AVAILABLE}/roundcube"
      REMOVED=true
    fi
    if [[ "${REMOVED}" = false ]]; then
      echo "No legacy config found"
    fi
    ;;

  *)
    echo "Usage: $0 {add-include|remove-include|cleanup-legacy} [domain]" >&2
    exit 1
    ;;
esac
