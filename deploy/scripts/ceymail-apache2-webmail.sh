#!/bin/bash
# CeyMail Mission Control — safe Apache config management for Roundcube webmail
# Mirrors the interface of ceymail-nginx-webmail for Apache-based servers.
# Install: cp deploy/scripts/ceymail-apache2-webmail.sh /usr/local/bin/ceymail-apache2-webmail && chmod 755 /usr/local/bin/ceymail-apache2-webmail
set -euo pipefail

CONF_AVAILABLE="/etc/apache2/conf-available"
CONF_ENABLED="/etc/apache2/conf-enabled"
SITES_ENABLED="/etc/apache2/sites-enabled"
SITES_AVAILABLE="/etc/apache2/sites-available"

case "${1:-}" in
  add-include)
    DOMAIN="${2:-}"
    # Validate domain: RFC-compliant labels, 2+ char alpha TLD, max 253 chars
    if [[ -z "${DOMAIN}" ]] || [[ ${#DOMAIN} -gt 253 ]] || \
       [[ ! "${DOMAIN}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$ ]]; then
      echo "ERROR: Invalid or missing domain" >&2
      exit 1
    fi

    # Check that Roundcube's Apache conf exists (installed by the roundcube package)
    RC_CONF=""
    if [[ -f "${CONF_AVAILABLE}/roundcube.conf" ]]; then
      RC_CONF="roundcube"
    elif [[ -f "/etc/roundcube/apache.conf" ]]; then
      # Some distributions place it at /etc/roundcube/apache.conf instead of
      # conf-available. Symlink it so a2enconf can find it.
      ln -sf /etc/roundcube/apache.conf "${CONF_AVAILABLE}/roundcube.conf"
      RC_CONF="roundcube"
    fi

    if [[ -z "${RC_CONF}" ]]; then
      echo "ERROR: Roundcube Apache config not found in ${CONF_AVAILABLE}/ or /etc/roundcube/apache.conf" >&2
      exit 1
    fi

    # Check if already enabled
    if [[ -f "${CONF_ENABLED}/roundcube.conf" ]] || [[ -L "${CONF_ENABLED}/roundcube.conf" ]]; then
      echo "Already enabled in Apache"
      exit 0
    fi

    # Enable the Roundcube conf
    /usr/sbin/a2enconf roundcube 2>/dev/null

    # Validate Apache config before declaring success
    if ! /usr/sbin/apache2ctl configtest 2>&1; then
      echo "ERROR: Apache config test failed after enabling roundcube — rolling back" >&2
      /usr/sbin/a2disconf roundcube 2>/dev/null || true
      exit 1
    fi

    echo "Enabled Roundcube in Apache for ${DOMAIN}"
    ;;

  remove-include)
    # Disable Roundcube Apache conf if enabled
    if [[ -f "${CONF_ENABLED}/roundcube.conf" ]] || [[ -L "${CONF_ENABLED}/roundcube.conf" ]]; then
      /usr/sbin/a2disconf roundcube 2>/dev/null
      echo "Disabled Roundcube in Apache"
    else
      echo "Roundcube not currently enabled"
    fi
    ;;

  cleanup-legacy)
    # Remove old standalone Roundcube Apache vhosts (pre-/webmail migration)
    REMOVED=false

    # Check sites-enabled for any roundcube-related vhosts
    for f in "${SITES_ENABLED}"/roundcube* "${SITES_ENABLED}"/webmail*; do
      if [[ -f "${f}" ]] || [[ -L "${f}" ]]; then
        rm -f "${f}"
        echo "Removed ${f}"
        REMOVED=true
      fi
    done

    # Check sites-available for any roundcube-related vhosts
    for f in "${SITES_AVAILABLE}"/roundcube* "${SITES_AVAILABLE}"/webmail*; do
      if [[ -f "${f}" ]]; then
        rm -f "${f}"
        echo "Removed ${f}"
        REMOVED=true
      fi
    done

    if [[ "${REMOVED}" = false ]]; then
      echo "No legacy config found"
    fi
    ;;

  *)
    echo "Usage: $0 {add-include|remove-include|cleanup-legacy} [domain]" >&2
    exit 1
    ;;
esac
