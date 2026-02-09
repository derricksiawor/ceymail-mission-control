#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

echo "Installing CeyMail v3.4.0 - Enhanced Security Edition"
sleep 1s

# ---------------------- FUNCTIONS ------------------------

install_php() {
  local supported_versions=("7.2" "7.3" "7.4" "8.0" "8.2")
  if [[ ! " ${supported_versions[*]} " =~ " ${php_v} " ]]; then
    echo "Invalid PHP version. Supported: ${supported_versions[*]}"
    exit 1
  fi

  apt update
  apt install -y software-properties-common lsb-release ca-certificates apt-transport-https wget gnupg

  if [[ $php_v == "8.2" ]]; then
    # PHP 8.2 available in Debian 12, no need for external PPA
    echo "Using native PHP 8.2 from Debian repos."
  else
    if ! grep -q "packages.sury.org/php" /etc/apt/sources.list.d/* 2>/dev/null; then
      wget -qO - https://packages.sury.org/php/apt.gpg | tee /etc/apt/keyrings/sury.gpg >/dev/null
      echo "deb [signed-by=/etc/apt/keyrings/sury.gpg] https://packages.sury.org/php $(lsb_release -sc) main" | tee /etc/apt/sources.list.d/php.list
    fi
  fi

  apt update
  apt install -y php$php_v php$php_v-cli php$php_v-common php$php_v-mysql php$php_v-zip php$php_v-gd \
    php$php_v-intl php$php_v-opcache php$php_v-xml php$php_v-mbstring php$php_v-curl php$php_v-bcmath libapache2-mod-php$php_v

  a2dismod php5.6 php7.0 php7.1 php7.2 php7.3 php7.4 php8.0 php8.2 >/dev/null 2>&1
  a2enmod php$php_v >/dev/null 2>&1

  # Backup & configure php.ini
  php_ini="/etc/php/$php_v/apache2/php.ini"
  if [ -f "$php_ini" ]; then
    [ -f "$php_ini.bak" ] && mv "$php_ini.bak" "$php_ini.bak.$(date +%s)"
    cp "$php_ini" "$php_ini.bak"
    declare -A php_settings=(
      ["upload_max_filesize"]="100M"
      ["post_max_size"]="64M"
      ["memory_limit"]="256M"
      ["file_uploads"]="On"
      ["max_execution_time"]="600"
      ["allow_url_fopen"]="On"
      ["date.timezone"]="America/Chicago"
      ["short_open_tag"]="On"
      ["max_input_vars"]="5000"
      ["max_input_time"]="600"
    )
    for key in "${!php_settings[@]}"; do
      sed -i "s|^\s*${key}\s*=.*|${key} = ${php_settings[$key]}|g" "$php_ini"
    done
  else
    echo "Warning: php.ini not found for PHP $php_v"
  fi
}

configure_apache_security() {
  apache_conf="/etc/apache2/apache2.conf"
  if [ -f "$apache_conf" ]; then
    cp "$apache_conf" "$apache_conf.bak" 2>/dev/null
    grep -q "ServerSignature" "$apache_conf" && sed -i 's|.*ServerSignature.*|ServerSignature Off|g' "$apache_conf" || echo "ServerSignature Off" >> "$apache_conf"
    grep -q "ServerTokens" "$apache_conf" && sed -i 's|.*ServerTokens.*|ServerTokens Prod|g' "$apache_conf" || echo "ServerTokens Prod" >> "$apache_conf"
  fi
}

setup_unbound_dns() {
  echo "Installing and configuring Unbound DNS resolver for DNSBL protection..."
  apt install -y unbound
  
  # Backup original resolv.conf
  [ -f /etc/resolv.conf ] && cp /etc/resolv.conf /etc/resolv.conf.bak
  
  # Configure Unbound as local resolver
  echo "nameserver 127.0.0.1" > /etc/resolv.conf
  
  # Configure systemd-resolved if present
  if systemctl is-active --quiet systemd-resolved; then
    echo "Configuring systemd-resolved to use Unbound..."
    mkdir -p /etc/systemd/resolved.conf.d
    cat > /etc/systemd/resolved.conf.d/unbound.conf << EOF
[Resolve]
DNS=127.0.0.1
DNSStubListener=no
EOF
    systemctl restart systemd-resolved
  fi
  
  # Start and enable Unbound
  systemctl enable unbound
  systemctl restart unbound
  
  echo "Unbound DNS resolver configured successfully."
}

setup_mail_logging() {
  echo "Setting up enhanced mail logging..."
  
  # Install rsyslog if not present
  apt install -y rsyslog
  
  # Configure mail logging
  if ! grep -q "mail.*" /etc/rsyslog.d/50-default.conf; then
    echo "mail.*    -/var/log/mail.log" >> /etc/rsyslog.d/50-default.conf
  fi
  
  # Create log files with proper permissions
  touch /var/log/mail.log
  chmod 640 /var/log/mail.log
  
  # Enable and restart rsyslog
  systemctl enable rsyslog
  systemctl restart rsyslog
  
  echo "Mail logging configured successfully."
}

setup_ceymail() {
  rm -f /usr/local/bin/ceymail
  mkdir -p /ceymail
  mv ceymail update LICENSE README /ceymail/. >/dev/null 2>&1
  chmod -R 755 /ceymail
  ln -s /ceymail/ceymail /usr/local/bin/ceymail
}

setup_cron() {
  if ! grep -q "/ceymail/update" /etc/crontab; then
    echo "0 */12 * * * root /ceymail/update" >> /etc/crontab
  else
    echo "CeyMail update cron is already set."
  fi
}

# -------------------- MAIN LOGIC -------------------------

read -p "Install & configure PHP (y/n): " install_php_ans

if [[ "$install_php_ans" =~ ^(y|yes)$ ]]; then
  read -p "Enter PHP version (7.2, 7.3, 7.4, 8.0, 8.2): " php_v
  install_php
elif [[ "$install_php_ans" =~ ^(n|no)$ ]]; then
  :
else
  echo "Invalid input. Exiting."
  exit 1
fi

echo "Installing CeyMail core packages..."
apt update
debconf-set-selections <<< "postfix postfix/mailname string $domain"
debconf-set-selections <<< "postfix postfix/main_mailer_type string 'Internet Site'"

# Install core packages including DNS tools and logging
apt install -y apache2 certbot python3-certbot-apache \
  wget unzip curl spamassassin spamc mariadb-server postfix postfix-mysql postfix-policyd-spf-python postfix-pcre \
  dovecot-common dovecot-imapd dovecot-pop3d dovecot-core dovecot-sieve dovecot-lmtpd dovecot-mysql \
  opendkim opendkim-tools coreutils dos2unix dnsutils rsyslog

apt install --reinstall -y coreutils

# Configure security and hardening
configure_apache_security
setup_unbound_dns
setup_mail_logging
setup_ceymail
setup_cron

# Enable Apache modules
a2enmod rewrite >/dev/null 2>&1

# Enable all services with systemctl
echo "Enabling services..."
systemctl enable apache2
systemctl enable mariadb
systemctl enable postfix
systemctl enable dovecot
systemctl enable opendkim
systemctl enable spamassassin
systemctl enable unbound
systemctl enable rsyslog

echo ""
echo "CeyMail has been installed successfully with enhanced security!"
echo "✅ Unbound DNS resolver configured for DNSBL protection"
echo "✅ Enhanced mail logging enabled"
echo "✅ DNS tools installed for testing"
echo ""
echo "Next: Run 'ceymail' to configure your mail server."
echo ""

rm -f install