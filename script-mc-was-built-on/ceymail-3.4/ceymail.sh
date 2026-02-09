#!/bin/bash
#Author: Derrick S K Siawor
#Company: Derk Online © Copyright 2017 - 2022

#This is CeyMail

echo ""
echo "CeyMail v3.4.0 - Enhanced Security Edition"
printf "Developer: Derrick S K Siawor\n"
printf "Company: Derk Online © Copyright 2017 - 2022\n"
printf "Support: derrick@derkonline.com\n"

if [ "$EUID" -ne 0 ];
  then echo "Please run as root"
  exit 0
fi


viewupdatelog(){

cat <<EOF > log.txt

Version 3.4.0 - Enhanced Security Edition
------------------------------------------
* 🔒 MAJOR SECURITY ENHANCEMENTS:
  - Enhanced DNSBL protection with multiple RBL sources (Spamhaus, SpamCop, Barracuda)
  - Unbound DNS resolver integration for improved DNSBL effectiveness
  - Fixed DNS resolver rejection issues
  - Removed invalid SpamAssassin milter socket configuration

* 🛠️ DEBIAN 12 COMPATIBILITY:
  - Migrated from 'service' to 'systemctl' commands
  - Updated package dependencies for Debian 12
  - Enhanced systemd service management
  - PHP 8.2 native support (no external PPA needed)

* 📊 ENHANCED LOGGING & MONITORING:
  - Comprehensive mail logging with rsyslog integration
  - Detailed Dovecot logging configuration
  - Mail queue monitoring and management
  - DNSBL functionality testing tools

* 🔧 IMPROVED CONFIGURATION:
  - Cleaner Postfix restriction rules
  - Better error handling and validation
  - Enhanced permission management
  - Automated service enabling with systemctl

* 🧪 NEW TESTING & DEBUGGING TOOLS:
  - DNS resolution testing through Unbound
  - DNSBL configuration verification
  - Mail queue status monitoring
  - Comprehensive system health checks

* 📦 ADDITIONAL IMPROVEMENTS:
  - DNS utilities (dnsutils) included for testing
  - Robust error handling throughout
  - Modern systemd integration
  - Enhanced user experience with better feedback

Previous Versions:
Version 3.3.4
-------------
* Fixed a bug that prevented users from being created.
* Added ability to create databases that has hyphens.
* Made some updates to permissions
* Added automatic updates.
* Added update checking feature.
* Bug fixes.
* Enhanced CeyMail menu.
* Added option to view mail log.
* Added option to clear mail queue.
* Added extra security to postfix to prevent spam.
* Fixed OpenDkim DKIM-Keys being deleted upon re-install.

EOF

if [[ ! -d ~/ceymail ]]; then
	mkdir -p ~/ceymail
fi

mv log.txt tmp && mv tmp ~/ceymail/log.txt

cat ~/ceymail/log.txt

echo "You can find the log at ~/ceymail/log.txt"

}

precedingceymail="ceymail"

########### START CEYWEBMAIL ############

ceywebmail(){
echo ""
echo "Your 'A DNS Record' ceymail.yourdomain.com should already be pointing to your server or the setup will fail!"
echo ""
echo "IMPORTANT"
echo "---------"
echo "Your mail server should be the main domain name for the server if it is a multi-domain server"
echo "If your domain is yourdomain.com, enter 'yourdomain' for the First Part and 'com' for the TLD. The software will automatically add ceymail to your domain."
echo "Replace yourdomain with your actual domain name."
echo ""

# Start WM Install

wminstall(){

echo ""
read -p "Your mail server (mailserver.com): " hostdomain
read -p "First part of your actual domain you want to setup the webmail (yourdomain): " wmsitename
read -p "Second part of the domain you want to setup the webmail without the dot (com,net,etc...): " tld
read -p "MySQL root user password(enter 'none' if no password): " mysqlpw

openssl rand -hex 8 > randomuser
openssl rand -hex 16 > randompass
openssl rand -hex 24 > random_session_key
wmdomain=$wmsitename'.'$tld
wmdb=$precedingceymail'_'$wmsitename
ceydomain=$precedingceymail'.'$wmdomain
wmdbuser=$(cat randomuser)
wmdbpass=$(cat randompass)
imap_session_key=$(cat random_session_key)
adminemail="help@derkonline.com"
rm -rf randomuser randompass random_session_key


if [[ "$wmsitename" == *".com"* ]]; then
	echo ""
	echo "Error: Enter Domain Name WITHOUT TLD and WITHOUT DOT. Please try again"
	echo ""
	exit 0
fi
if [[ "$wmsitename" == *".org"* ]]; then
	echo ""
	echo "Error: Enter Domain Name WITHOUT TLD and WITHOUT DOT. Please try again"
	echo ""
	exit 0
fi
if [[ "$wmsitename" == *".net"* ]]; then
	echo ""
	echo "Error: Enter Domain Name WITHOUT TLD and WITHOUT DOT. Please try again"
	echo ""
	exit 0
fi

ceymail_dir=/var/www/html/public_html/ceymails/$wmsitename

# Check if CeyWebmail folder already exists.

if [[ ! -e $ceymail_dir ]]; then
	mkdir -p $ceymail_dir

elif [[ -e $ceymail_dir ]]; then
	echo "Error: $wmsitename folder already exists at $ceymail_dir"

	read -p "Remove and recreate?  [y or n]: " rmrf

		if [[ $rmrf == 'y' || $rmrf == 'yes' ]]; then
			rm -rf $ceymail_dir
			mkdir -p $ceymail_dir

		elif [[ $rmrf == 'n' || $rmrf == 'no' ]]; then
			exit 0

		else
			echo "Incorrect input. Please try again."
			exit 0
		fi
fi

# Downloading & configuring webmail

echo "Installing CeyWebmail"

# Downloading

sleep 1s

cd $ceymail_dir
wget -q https://github.com/roundcube/roundcubemail/releases/download/1.6.4/roundcubemail-1.6.4-complete.tar.gz -O webmail.tar.gz
tar xf webmail.tar.gz > /dev/null
cp -r roundcubemail-1.6.4/. .
rm -r webmail.tar.gz roundcubemail-1.6.4

# Configuring

# Roundcube Config.inc.php file

cat <<EOF > config.inc.php
<?php

/* Local configuration for Roundcube Webmail */

// ----------------------------------

// SQL DATABASE

// ----------------------------------

// Database connection string (DSN) for read+write operations

// Format (compatible with PEAR MDB2): db_provider://user:password@host/database

// Currently supported db_providers: mysql, pgsql, sqlite, mssql, sqlsrv, oracle

// For examples see http://pear.php.net/manual/en/package.database.mdb2.intro-dsn.php

// Note: for SQLite use absolute path (Linux): 'sqlite:////full/path/to/sqlite.db?mode=0646'

//       or (Windows): 'sqlite:///C:/full/path/to/sqlite.db'

// Note: Various drivers support various additional arguments for connection,

//       for Mysql: key, cipher, cert, capath, ca, verify_server_cert,

//       for Postgres: application_name, sslmode, sslcert, sslkey, sslrootcert, sslcrl, sslcompression, service.

//       e.g. 'mysql://roundcube:@localhost/roundcubemail?verify_server_cert=false'

\$config['db_dsnw'] = 'mysql://$wmdbuser:$wmdbpass@localhost/$wmdb';

// ----------------------------------

// IMAP

// ----------------------------------

// The IMAP host chosen to perform the log-in.

// Leave blank to show a textbox at login, give a list of hosts

// to display a pulldown menu or set one host as string.

// Enter hostname with prefix ssl:// to use Implicit TLS, or use

// prefix tls:// to use STARTTLS.

// Supported replacement variables:

// %n - hostname ($_SERVER['SERVER_NAME'])

// %t - hostname without the first part

// %d - domain (http hostname $_SERVER['HTTP_HOST'] without the first part)

// %s - domain name after the '@' from e-mail address provided at login screen

// For example %n = mail.domain.tld, %t = domain.tld

// WARNING: After hostname change update of mail_host column in users table is

//          required to match old user data records with the new host.

\$config['default_host'] = 'ssl://$hostdomain';

// TCP port used for IMAP connections

\$config['default_port'] = 993;

// provide an URL where a user can get support for this Roundcube installation

// PLEASE DO NOT LINK TO THE ROUNDCUBE.NET WEBSITE HERE!

\$config['support_url'] = 'https://ceymail.com';

// This key is used for encrypting purposes, like storing of imap password

// in the session. For historical reasons it's called DES_key, but it's used

// with any configured cipher_method (see below).

// For the default cipher_method a required key length is 24 characters.

\$config['des_key'] = '$imap_session_key';

// Name your service. This is displayed on the login screen and in the window title

\$config['product_name'] = 'CeyMail';

// ----------------------------------

// PLUGINS

// ----------------------------------

// List of active plugins (in plugins/ directory)

// \$config['plugins'] = ['additional_message_headers', 'archive', 'attachment_reminder', 'database_attachments', 'emoticons', 'filesystem_attachments', 'help', 'identity_select', 'markasjunk', 'new_user_identity', 'newmail_notifier', 'reconnect', 'show_additional_headers', 'userinfo', 'zipdownload'];

\$config['plugins'] = ['additional_message_headers', 'archive', 'attachment_reminder', 'database_attachments', 'emoticons', 'filesystem_attachments', 'identity_select', 'markasjunk', 'new_user_identity', 'newmail_notifier', 'reconnect', 'show_additional_headers', 'zipdownload'];

// the default locale setting (leave empty for auto-detection)

// RFC1766 formatted language name like en_US, de_DE, de_CH, fr_FR, pt_BR

\$config['language'] = 'en_US';

EOF

# Roundcube Defaults.inc.php File

cat <<EOF > defaults.inc.php
<?php

// ---------------------------------------------------------------------
// WARNING: Do not edit this file! Copy configuration to config.inc.php.
// ---------------------------------------------------------------------

/*
 +-----------------------------------------------------------------------+
 | Default settings for all configuration options                        |
 |                                                                       |
 | This file is part of the Roundcube Webmail client                     |
 | Copyright (C) The Roundcube Dev Team                                  |
 |                                                                       |
 | Licensed under the GNU General Public License version 3 or            |
 | any later version with exceptions for skins & plugins.                |
 | See the README file for a full license statement.                     |
 +-----------------------------------------------------------------------+
*/

\$config = [];

// ----------------------------------
// SQL DATABASE
// ----------------------------------

\$config['db_dsnw'] = 'mysql://$wmdbuser:$wmdbpass@localhost/\`$wmdb\`';

\$config['db_dsnr'] = '';

\$config['db_dsnw_noread'] = false;

\$config['db_persistent'] = false;

\$config['db_prefix'] = '';

\$config['db_table_dsn'] = [
//    'cache' => 'r',
//    'cache_index' => 'r',
//    'cache_thread' => 'r',
//    'cache_messages' => 'r',
];

\$config['db_max_allowed_packet'] = null;


// ----------------------------------
// LOGGING/DEBUGGING
// ----------------------------------

// log driver:  'syslog', 'stdout' or 'file'.
\$config['log_driver'] = 'file';

// (read http://php.net/manual/en/function.date.php for all format characters)
\$config['log_date_format'] = 'd-M-Y H:i:s O';

// set to 0 to avoid session IDs being logged.
\$config['log_session_id'] = 8;

// Default extension used for log file name
\$config['log_file_ext'] = '.log';

// Syslog ident string to use, if using the 'syslog' log driver.
\$config['syslog_id'] = 'roundcube';

\$config['syslog_facility'] = LOG_USER;

\$config['per_user_logging'] = false;

\$config['smtp_log'] = true;

// Log successful/failed logins to <log_dir>/userlogins.log or to syslog
\$config['log_logins'] = false;

// Log session debug information/authentication errors to <log_dir>/session.log or to syslog
\$config['session_debug'] = false;

// Log SQL queries to <log_dir>/sql.log or to syslog
\$config['sql_debug'] = false;

// Log IMAP conversation to <log_dir>/imap.log or to syslog
\$config['imap_debug'] = false;

// Log LDAP conversation to <log_dir>/ldap.log or to syslog
\$config['ldap_debug'] = false;

// Log SMTP conversation to <log_dir>/smtp.log or to syslog
\$config['smtp_debug'] = false;

// Log Memcache conversation to <log_dir>/memcache.log or to syslog
\$config['memcache_debug'] = false;

// Log APC conversation to <log_dir>/apc.log or to syslog
\$config['apc_debug'] = false;

// Log Redis conversation to <log_dir>/redis.log or to syslog
\$config['redis_debug'] = false;


// ----------------------------------
// IMAP
// ----------------------------------

\$config['default_host'] = 'ssl://$hostdomain';

// TCP port used for IMAP connections
\$config['default_port'] = 993;

// By default the most secure method (from supported) will be selected.
\$config['imap_auth_type'] = null;

// The example below enables server certificate validation
\$config['imap_conn_options'] = [
  'ssl'         => [
     'verify_peer'  => true,
     'verify_depth' => 3,
     'cafile'       => '/etc/letsencrypt/live/mail/fullchain.pem',
   ],
 ];

\$config['imap_conn_options'] = null;

// IMAP connection timeout, in seconds. Default: 0 (use default_socket_timeout)
\$config['imap_timeout'] = 0;

// Optional IMAP authentication identifier to be used as authorization proxy
\$config['imap_auth_cid'] = null;

// Optional IMAP authentication password to be used for imap_auth_cid
\$config['imap_auth_pw'] = null;

// Otherwise it will be determined automatically
\$config['imap_delimiter'] = null;

// identifiers, e.g. 'dovecot', 'cyrus', 'gimap', 'hmail', 'uw-imap'.
\$config['imap_vendor'] = null;

// Note: Set these to FALSE to disable access to specified namespace
\$config['imap_ns_personal'] = null;
\$config['imap_ns_other']    = null;
\$config['imap_ns_shared']   = null;

// after login. Set to True if you've got this case.
\$config['imap_force_caps'] = false;

// Deprecated: Use imap_disabled_caps = ['LIST-EXTENDED']
\$config['imap_force_lsub'] = false;

// Enable this option to force listing of folders in all namespaces
\$config['imap_force_ns'] = false;

// Some servers return hidden folders (name starting with a dot)
\$config['imap_skip_hidden_folders'] = false;

// By default it will be determined automatically (once per user session).
\$config['imap_dual_use_folders'] = null;

// Note: Because the list is cached, re-login is required after change.
\$config['imap_disabled_caps'] = [];

// This is used to relate IMAP session with Roundcube user sessions
\$config['imap_log_session'] = false;

// Type of IMAP indexes cache. Supported values: 'db', 'apc' and 'memcache' or 'memcached'.
\$config['imap_cache'] = null;

// for further info, or if you experience syncing problems.
\$config['messages_cache'] = false;

// Lifetime of IMAP indexes cache. Possible units: s, m, h, d, w
\$config['imap_cache_ttl'] = '10d';

// Lifetime of messages cache. Possible units: s, m, h, d, w
\$config['messages_cache_ttl'] = '10d';

// Note: On MySQL this should be less than (max_allowed_packet - 30%)
\$config['messages_cache_threshold'] = 50;


// ----------------------------------
// SMTP
// ----------------------------------

// of IMAP host (no prefix or port) and SMTP server e.g. ['imap.example.com' => 'smtp.example.net']
\$config['smtp_server'] = 'tls://$hostdomain';

// SMTP port. Use 25 for cleartext, 465 for Implicit TLS, or 587 for STARTTLS (default)
\$config['smtp_port'] = 587;

// SMTP username (if required) if you use %u as the username Roundcube
// will use the current username for login
\$config['smtp_user'] = '%u';

// will use the current user's password for login
\$config['smtp_pass'] = '%p';

// best server supported one)
\$config['smtp_auth_type'] = null;

// Optional SMTP authentication identifier to be used as authorization proxy
\$config['smtp_auth_cid'] = null;

// Optional SMTP authentication password to be used for smtp_auth_cid
\$config['smtp_auth_pw'] = null;

// Pass the username (XCLIENT LOGIN) to the server
\$config['smtp_xclient_login'] = false;

// Pass the remote IP (XCLIENT ADDR) to the server
\$config['smtp_xclient_addr'] = false;


// localhost if that isn't defined.
\$config['smtp_helo_host'] = '$wmdomain';

// timeout > 0 causes connection errors (https://bugs.php.net/bug.php?id=54511)
\$config['smtp_timeout'] = 0;

 \$config['smtp_conn_options'] = [
     'ssl'         => [
     'verify_peer'  => true,
     'verify_depth' => 3,
     'cafile'       => '/etc/letsencrypt/live/mail/fullchain.pem',
   ],
];
// Note: These can be also specified as an array of options indexed by hostname
\$config['smtp_conn_options'] = null;


// ----------------------------------
// OAuth
// ----------------------------------

// Enable OAuth2 by defining a provider. Use 'generic' here
\$config['oauth_provider'] = null;

// Provider name to be displayed on the login button
\$config['oauth_provider_name'] = 'Google';

// Mandatory: OAuth client ID for your Roundcube installation
\$config['oauth_client_id'] = null;

// Mandatory: OAuth client secret
\$config['oauth_client_secret'] = null;

// Mandatory: URI for OAuth user authentication (redirect)
\$config['oauth_auth_uri'] = null;

// Mandatory: Endpoint for OAuth authentication requests (server-to-server)
\$config['oauth_token_uri'] = null;

// Optional: Endpoint to query user identity if not provided in auth response
\$config['oauth_identity_uri'] = null;

// Optional: disable SSL certificate check on HTTP requests to OAuth server
// See http://docs.guzzlephp.org/en/stable/request-options.html#verify for possible values
\$config['oauth_verify_peer'] = true;

// Mandatory: OAuth scopes to request (space-separated string)
\$config['oauth_scope'] = null;

// Optional: additional query parameters to send with login request (hash array)
\$config['oauth_auth_parameters'] = [];

// Optional: array of field names used to resolve the username within the identity information
\$config['oauth_identity_fields'] = null;

// Boolean: automatically redirect to OAuth login when opening Roundcube without a valid session
\$config['oauth_login_redirect'] = false;

///// Example config for Gmail

// Register your service at https://console.developers.google.com/
// - use https://<your-roundcube-url>/index.php/login/oauth as redirect URL

// \$config['default_host'] = 'ssl://imap.gmail.com';
// \$config['oauth_provider'] = 'google';
// \$config['oauth_provider_name'] = 'Google';
// \$config['oauth_client_id'] = "<your-credentials-client-id>";
// \$config['oauth_client_secret'] = "<your-credentials-client-secret>";
// \$config['oauth_auth_uri'] = "https://accounts.google.com/o/oauth2/auth";
// \$config['oauth_token_uri'] = "https://oauth2.googleapis.com/token";
// \$config['oauth_identity_uri'] = 'https://www.googleapis.com/oauth2/v1/userinfo';
// \$config['oauth_scope'] = "email profile openid https://mail.google.com/";
// \$config['oauth_auth_parameters'] = ['access_type' => 'offline', 'prompt' => 'consent'];

///// Example config for Outlook.com (Office 365)

// Register your OAuth client at https://portal.azure.com
// - use https://<your-roundcube-url>/index.php/login/oauth as redirect URL
// - grant permissions to Microsoft Graph API "IMAP.AccessAsUser.All", "SMTP.Send", "User.Read" and "offline_access"

// \$config['default_host'] = 'ssl://outlook.office365.com';
// \$config['smtp_server'] = 'ssl://smtp.office365.com';

// \$config['oauth_provider'] = 'outlook';
// \$config['oauth_provider_name'] = 'Outlook.com';
// \$config['oauth_client_id'] = "<your-credentials-client-id>";
// \$config['oauth_client_secret'] = "<your-credentials-client-secret>";
// \$config['oauth_auth_uri'] = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
// \$config['oauth_token_uri'] = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
// \$config['oauth_identity_uri'] = "https://graph.microsoft.com/v1.0/me";
// \$config['oauth_identity_fields'] = ['email', 'userPrincipalName'];
// \$config['oauth_scope'] = "https://outlook.office365.com/IMAP.AccessAsUser.All https://outlook.office365.com/SMTP.Send User.Read offline_access";
// \$config['oauth_auth_parameters'] = ['nonce' => mt_rand()];

// ----------------------------------
// LDAP
// ----------------------------------

\$config['ldap_cache'] = 'db';

\$config['ldap_cache_ttl'] = '10m';


// ----------------------------------
// CACHE(S)
// ----------------------------------

\$config['memcache_hosts'] = null;

\$config['memcache_pconnect'] = true;

\$config['memcache_timeout'] = 1;

\$config['memcache_retry_interval'] = 15;

// Examples:
//     ['localhost:6379'];
//     ['192.168.1.1:6379:1:secret'];
//     ['unix:///var/run/redis/redis-server.sock:1:secret'];
\$config['redis_hosts'] = null;

// Maximum size of an object in memcache (in bytes). Default: 2MB
\$config['memcache_max_allowed_packet'] = '2M';

// Maximum size of an object in APC cache (in bytes). Default: 2MB
\$config['apc_max_allowed_packet'] = '2M';

// Maximum size of an object in Redis cache (in bytes). Default: 2MB
\$config['redis_max_allowed_packet'] = '2M';


// ----------------------------------
// SYSTEM
// ----------------------------------

\$config['enable_installer'] = false;

\$config['dont_override'] = [];

\$config['disabled_actions'] = [];

\$config['advanced_prefs'] = [];

\$config['support_url'] = '';

\$config['blankpage_url'] = '/watermark.html';

/*
   [
     // show the image /images/logo_login_small.png for the Login screen in the Elastic skin on small screens
     "elastic:login[small]" => "/images/logo_login_small.png",
     // show the image /images/logo_login.png for the Login screen in the Elastic skin
     "elastic:login" => "/images/logo_login.png",
     // show the image /images/logo_small.png in the Elastic skin
     "elastic:*[small]" => "/images/logo_small.png",
     // show the image /images/larry.png in the Larry skin
     "larry:*" => "/images/larry.png",
     // show the image /images/logo_login.png on the login template in all skins
     "login" => "/images/logo_login.png",
     // show the image /images/logo_print.png for all print type logos in all skins
     "[print]" => "/images/logo_print.png",
   ];
*/
\$config['skin_logo'] = null;

\$config['auto_create_user'] = true;

\$config['user_aliases'] = false;

\$config['log_dir'] = RCUBE_INSTALL_PATH . 'logs/';

\$config['temp_dir'] = RCUBE_INSTALL_PATH . 'temp/';

\$config['temp_dir_ttl'] = '48h';

\$config['force_https'] = false;

// tell PHP that it should work as under secure connection
// even if it doesn't recognize it as secure ($_SERVER['HTTPS'] is not set)
// e.g. when you're running Roundcube behind a https proxy
// this option is mutually exclusive to 'force_https' and only either one of them should be set to true.
\$config['use_https'] = false;

// Allow browser-autocompletion on login form.
// 0 - disabled, 1 - username and host only, 2 - username, host, password
\$config['login_autocomplete'] = 0;

// Forces conversion of logins to lower case.
// 0 - disabled, 1 - only domain part, 2 - domain and local part.
// If users authentication is case-insensitive this must be enabled.
// Note: After enabling it all user records need to be updated, e.g. with query:
//       UPDATE users SET username = LOWER(username);
\$config['login_lc'] = 2;

// Maximum length (in bytes) of logon username and password.
\$config['login_username_maxlen'] = 1024;
\$config['login_password_maxlen'] = 1024;

// Logon username filter. Regular expression for use with preg_match().
// Use special value 'email' if you accept only full email addresses as user logins.
// Example: '/^[a-z0-9_@.-]+$/'
\$config['login_username_filter'] = null;

// Brute-force attacks prevention.
// The value specifies maximum number of failed logon attempts per minute.
\$config['login_rate_limit'] = 3;

// Includes should be interpreted as PHP files
\$config['skin_include_php'] = false;

// display product name and software version on login screen
// 0 - hide product name and version number, 1 - show product name only, 2 - show product name and version number
\$config['display_product_info'] = 1;

// Session lifetime in minutes
\$config['session_lifetime'] = 10;

// Session domain: .example.org
\$config['session_domain'] = '';

// Session name. Default: 'roundcube_sessid'
\$config['session_name'] = null;

// Session authentication cookie name. Default: 'roundcube_sessauth'
\$config['session_auth_name'] = null;

// Session path. Defaults to PHP session.cookie_path setting.
\$config['session_path'] = null;

// Session samesite. Defaults to PHP session.cookie_samesite setting.
// Requires PHP >= 7.3.0, see https://wiki.php.net/rfc/same-site-cookie for more info
// Possible values: null (default), 'Lax', or 'Strict'
\$config['session_samesite'] = null;

// Backend to use for session storage. Can either be 'db' (default), 'redis', 'memcache', or 'php'
//
// If set to 'memcache' or 'memcached', a list of servers need to be specified in 'memcache_hosts'
// Make sure the Memcache extension (https://pecl.php.net/package/memcache) version >= 2.0.0
// or the Memcached extension (https://pecl.php.net/package/memcached) version >= 2.0.0 is installed.
//
// If set to 'redis', a server needs to be specified in 'redis_hosts'
// Make sure the Redis extension (https://pecl.php.net/package/redis) version >= 2.0.0 is installed.
//
// Setting this value to 'php' will use the default session save handler configured in PHP
\$config['session_storage'] = 'db';

// List of trusted proxies
// X_FORWARDED_* and X_REAL_IP headers are only accepted from these IPs
\$config['proxy_whitelist'] = [];

// List of trusted host names
// Attackers can modify Host header of the HTTP request causing $_SERVER['SERVER_NAME']
// or $_SERVER['HTTP_HOST'] variables pointing to a different host, that could be used
// to collect user names and passwords. Some server configurations prevent that, but not all.
// An empty list accepts any host name. The list can contain host names
// or PCRE patterns (without // delimiters, that will be added automatically).
\$config['trusted_host_patterns'] = [];

// check client IP in session authorization
\$config['ip_check'] = false;

// X-Frame-Options HTTP header value sent to prevent from Clickjacking.
// Possible values: sameorigin|deny|allow-from <uri>.
// Set to false in order to disable sending the header.
\$config['x_frame_options'] = 'sameorigin';

// This key is used for encrypting purposes, like storing of imap password
// in the session. For historical reasons it's called DES_key, but it's used
// with any configured cipher_method (see below).
// For the default cipher_method a required key length is 24 characters.
\$config['des_key'] = 'rcmail-!24ByteDESkey*Str';

// Encryption algorithm. You can use any method supported by OpenSSL.
// Default is set for backward compatibility to DES-EDE3-CBC,
// but you can choose e.g. AES-256-CBC which we consider a better choice.
\$config['cipher_method'] = 'DES-EDE3-CBC';

// Automatically add this domain to user names for login
// Only for IMAP servers that require full e-mail addresses for login
// Specify an array with 'host' => 'domain' values to support multiple hosts
// Supported replacement variables:
// %h - user's IMAP hostname
// %n - hostname ($_SERVER['SERVER_NAME'])
// %t - hostname without the first part
// %d - domain (http hostname $_SERVER['HTTP_HOST'] without the first part)
// %z - IMAP domain (IMAP hostname without the first part)
// For example %n = mail.domain.tld, %t = domain.tld
\$config['username_domain'] = '';

// Force domain configured in username_domain to be used for login.
// Any domain in username will be replaced by username_domain.
\$config['username_domain_forced'] = false;

// This domain will be used to form e-mail addresses of new users
// Specify an array with 'host' => 'domain' values to support multiple hosts
// Supported replacement variables:
// %h - user's IMAP hostname
// %n - http hostname ($_SERVER['SERVER_NAME'])
// %d - domain (http hostname without the first part)
// %z - IMAP domain (IMAP hostname without the first part)
// For example %n = mail.domain.tld, %t = domain.tld
\$config['mail_domain'] = '';

// Password character set, to change the password for user
// authentication or for password change operations
\$config['password_charset'] = 'UTF-8';

// How many seconds must pass between emails sent by a user
\$config['sendmail_delay'] = 0;

// Message size limit. Note that SMTP server(s) may use a different value.
// This limit is verified when user attaches files to a composed message.
// Size in bytes (possible unit suffix: K, M, G)
\$config['max_message_size'] = '100M';

// Maximum number of recipients per message (including To, Cc, Bcc).
// Default: 0 (no limit)
\$config['max_recipients'] = 0;

// Maximum number of recipients per message excluding Bcc header.
// This is a soft limit, which means we only display a warning to the user.
// Default: 5
\$config['max_disclosed_recipients'] = 5;

// Maximum allowed number of members of an address group. Default: 0 (no limit)
// If 'max_recipients' is set this value should be less or equal
\$config['max_group_members'] = 0;

// Name your service. This is displayed on the login screen and in the window title
\$config['product_name'] = 'Roundcube Webmail';

// Add this user-agent to message headers when sending. Default: not set.
\$config['useragent'] = null;

// try to load host-specific configuration
// see https://github.com/roundcube/roundcubemail/wiki/Configuration:-Multi-Domain-Setup
// for more details
\$config['include_host_config'] = false;

// path to a text file which will be added to each sent message
// paths are relative to the Roundcube root folder
\$config['generic_message_footer'] = '';

// path to a text file which will be added to each sent HTML message
// paths are relative to the Roundcube root folder
\$config['generic_message_footer_html'] = '';

// add a received header to outgoing mails containing the creators IP and hostname
\$config['http_received_header'] = false;

\$config['http_received_header_encrypt'] = false;

// number of chars allowed for line when wrapping text.
// text wrapping is done when composing/sending messages
\$config['line_length'] = 72;

// send plaintext messages as format=flowed
\$config['send_format_flowed'] = true;

// According to RFC2298, return receipt envelope sender address must be empty.
// If this option is true, Roundcube will use user's identity as envelope sender for MDN responses.
\$config['mdn_use_from'] = false;

// Set identities access level:
// 0 - many identities with possibility to edit all params
// 1 - many identities with possibility to edit all params but not email address
// 2 - one identity with possibility to edit all params
// 3 - one identity with possibility to edit all params but not email address
// 4 - one identity with possibility to edit only signature
\$config['identities_level'] = 1;

// Maximum size of uploaded image in kilobytes
// Images (in html signatures) are stored in database as data URIs
\$config['identity_image_size'] = 300;

// Mimetypes supported by the browser.
// Attachments of these types will open in a preview window.
// Either a comma-separated list or an array. Default list includes:
//     text/plain,text/html,
//     image/jpeg,image/gif,image/png,image/bmp,image/tiff,image/webp,
//     application/x-javascript,application/pdf,application/x-shockwave-flash
\$config['client_mimetypes'] = null;

// Path to a local mime magic database file for PHPs finfo extension.
// Set to null if the default path should be used.
\$config['mime_magic'] = null;

// Absolute path to a local mime.types mapping table file.
// This is used to derive mime-types from the filename extension or vice versa.
// Such a file is usually part of the apache webserver. If you don't find a file named mime.types on your system,
// download it from http://svn.apache.org/repos/asf/httpd/httpd/trunk/docs/conf/mime.types
\$config['mime_types'] = null;

// path to imagemagick identify binary (if not set we'll use Imagick or GD extensions)
\$config['im_identify_path'] = null;

// path to imagemagick convert binary (if not set we'll use Imagick or GD extensions)
\$config['im_convert_path'] = null;

// Size of thumbnails from image attachments displayed below the message content.
// Note: whether images are displayed at all depends on the 'inline_images' option.
// Set to 0 to display images in full size.
\$config['image_thumbnail_size'] = 240;

// maximum size of uploaded contact photos in pixel
\$config['contact_photo_size'] = 160;

// Enable DNS checking for e-mail address validation
\$config['email_dns_check'] = false;

// Disables saving sent messages in Sent folder (like gmail) (Default: false)
// Note: useful when SMTP server stores sent mail in user mailbox
\$config['no_save_sent_messages'] = false;

// Improve system security by using special URL with security token.
// This can be set to a number defining token length. Default: 16.
// Warning: This requires http server configuration. Sample:
//    RewriteRule ^/roundcubemail/[a-zA-Z0-9]{16}/(.*) /roundcubemail/$1 [PT]
//    Alias /roundcubemail /var/www/roundcubemail/
// Note: Use assets_path to not prevent the browser from caching assets
\$config['use_secure_urls'] = false;

// Allows to define separate server/path for image/js/css files
// Warning: If the domain is different cross-domain access to some
// resources need to be allowed
// Sample:
//    <FilesMatch ".(eot|ttf|woff)">
//    Header set Access-Control-Allow-Origin "*"
//    </FilesMatch>
\$config['assets_path'] = '';

// While assets_path is for the browser, assets_dir informs
// PHP code about the location of asset files in filesystem
\$config['assets_dir'] = '';

// Options passed when creating Guzzle HTTP client, used to fetch remote content
// For example:
// [
//   'timeout' => 10,
//   'proxy' => 'tcp://localhost:8125',
// ]
\$config['http_client'] = [];

// List of supported subject prefixes for a message reply
// This list is used to clean the subject when replying or sorting messages
\$config['subject_reply_prefixes'] = ['Re:'];

// List of supported subject prefixes for a message forward
// This list is used to clean the subject when forwarding or sorting messages
\$config['subject_forward_prefixes'] = ['Fwd:', 'Fw:'];

// Prefix to use in subject when replying to a message
\$config['response_prefix'] = 'Re:';

// Prefix to use in subject when forwarding a message
\$config['forward_prefix'] = 'Fwd:';

// ----------------------------------
// PLUGINS
// ----------------------------------

// List of active plugins (in plugins/ directory)
\$config['plugins'] = [];

// ----------------------------------
// USER INTERFACE
// ----------------------------------

// default messages sort column. Use empty value for default server's sorting,
// or 'arrival', 'date', 'subject', 'from', 'to', 'fromto', 'size', 'cc'
\$config['message_sort_col'] = '';

// default messages sort order
\$config['message_sort_order'] = 'DESC';

// These cols are shown in the message list. Available cols are:
// subject, from, to, fromto, cc, replyto, date, size, status, flag, attachment, priority
\$config['list_cols'] = ['subject', 'status', 'fromto', 'date', 'size', 'flag', 'attachment'];

// the default locale setting (leave empty for auto-detection)
// RFC1766 formatted language name like en_US, de_DE, de_CH, fr_FR, pt_BR
\$config['language'] = null;

// use this format for date display (date or strftime format)
\$config['date_format'] = 'Y-m-d';

// give this choice of date formats to the user to select from
// Note: do not use ambiguous formats like m/d/Y
\$config['date_formats'] = ['Y-m-d', 'Y/m/d', 'Y.m.d', 'd-m-Y', 'd/m/Y', 'd.m.Y', 'j.n.Y'];

// use this format for time display (date or strftime format)
\$config['time_format'] = 'H:i';

// give this choice of time formats to the user to select from
\$config['time_formats'] = ['G:i', 'H:i', 'g:i a', 'h:i A'];

// use this format for short date display (derived from date_format and time_format)
\$config['date_short'] = 'D H:i';

// use this format for detailed date/time formatting (derived from date_format and time_format)
\$config['date_long'] = 'Y-m-d H:i';

// store draft message is this mailbox
// leave blank if draft messages should not be stored
// NOTE: Use folder names with namespace prefix (INBOX. on Courier-IMAP)
\$config['drafts_mbox'] = 'Drafts';

// store spam messages in this mailbox
// NOTE: Use folder names with namespace prefix (INBOX. on Courier-IMAP)
\$config['junk_mbox'] = 'Junk';

// store sent message is this mailbox
// leave blank if sent messages should not be stored
// NOTE: Use folder names with namespace prefix (INBOX. on Courier-IMAP)
\$config['sent_mbox'] = 'Sent';

// move messages to this folder when deleting them
// leave blank if they should be deleted directly
// NOTE: Use folder names with namespace prefix (INBOX. on Courier-IMAP)
\$config['trash_mbox'] = 'Trash';

// automatically create the above listed default folders on user login
\$config['create_default_folders'] = false;

// protect the default folders from renames, deletes, and subscription changes
\$config['protect_default_folders'] = true;

// Disable localization of the default folder names listed above
\$config['show_real_foldernames'] = false;

// if in your system 0 quota means no limit set this option to true
\$config['quota_zero_as_unlimited'] = false;

// Make use of the built-in spell checker.
\$config['enable_spellcheck'] = true;

// Enables spellchecker exceptions dictionary.
// Setting it to 'shared' will make the dictionary shared by all users.
\$config['spellcheck_dictionary'] = false;

// Set the spell checking engine. Possible values:
// - 'googie'  - the default (also used for connecting to Nox Spell Server, see 'spellcheck_uri' setting)
// - 'pspell'  - requires the PHP Pspell module and aspell installed
// - 'enchant' - requires the PHP Enchant module
// - 'atd'     - install your own After the Deadline server or check with the people at http://www.afterthedeadline.com before using their API
// Since Google shut down their public spell checking service, the default settings
// connect to http://spell.roundcube.net which is a hosted service provided by Roundcube.
// You can connect to any other googie-compliant service by setting 'spellcheck_uri' accordingly.
\$config['spellcheck_engine'] = 'googie';

// For locally installed Nox Spell Server or After the Deadline services,
// please specify the URI to call it.
// Get Nox Spell Server from http://orangoo.com/labs/?page_id=72 or
// the After the Deadline package from http://www.afterthedeadline.com.
// Leave empty to use the public API of service.afterthedeadline.com
\$config['spellcheck_uri'] = '';

// These languages can be selected for spell checking.
// Configure as a PHP style hash array: ['en'=>'English', 'de'=>'Deutsch'];
// Leave empty for default set of available language.
\$config['spellcheck_languages'] = null;

// Makes that words with all letters capitalized will be ignored (e.g. GOOGLE)
\$config['spellcheck_ignore_caps'] = false;

// Makes that words with numbers will be ignored (e.g. g00gle)
\$config['spellcheck_ignore_nums'] = false;

// Makes that words with symbols will be ignored (e.g. g@@gle)
\$config['spellcheck_ignore_syms'] = false;

// Number of lines at the end of a message considered to contain the signature.
// Increase this value if signatures are not properly detected and colored
\$config['sig_max_lines'] = 15;

// don't let users set pagesize to more than this value if set
\$config['max_pagesize'] = 200;

// Minimal value of user's 'refresh_interval' setting (in seconds)
\$config['min_refresh_interval'] = 60;

// Specifies for how many seconds the Undo button will be available
// after object delete action. Currently used with supporting address book sources.
// Setting it to 0, disables the feature.
\$config['undo_timeout'] = 0;

// A static list of canned responses which are immutable for the user
\$config['compose_responses_static'] = [
//  ['name' => 'Canned Response 1', 'text' => 'Static Response One'],
//  ['name' => 'Canned Response 2', 'text' => 'Static Response Two'],
];

// List of HKP key servers for PGP public key lookups in Enigma/Mailvelope
// Note: Lookup is client-side, so the server must support Cross-Origin Resource Sharing
\$config['keyservers'] = ['keys.openpgp.org'];

// Enables use of the Main Keyring in Mailvelope? If disabled, a per-site keyring
// will be used. This is set to false for backwards compatibility.
\$config['mailvelope_main_keyring'] = false;

// Mailvelope RSA bit size for newly generated keys, either 2048 or 4096.
// It maybe desirable to use 2048 for sites with many mobile users.
\$config['mailvelope_keysize'] = 4096;

// ----------------------------------
// ADDRESSBOOK SETTINGS
// ----------------------------------

// This indicates which type of address book to use. Possible choices:
// 'sql' - built-in sql addressbook enabled (default),
// ''    - built-in sql addressbook disabled.
//         Still LDAP or plugin-added addressbooks will be available.
//         BC Note: The value can actually be anything except 'sql', it does not matter.
\$config['address_book_type'] = 'sql';

// In order to enable public ldap search, configure an array like the Verisign
// example further below. if you would like to test, simply uncomment the example.
// Array key must contain only safe characters, ie. a-zA-Z0-9_
\$config['ldap_public'] = [];

// If you are going to use LDAP for individual address books, you will need to
// set 'user_specific' to true and use the variables to generate the appropriate DNs to access it.
//
// The recommended directory structure for LDAP is to store all the address book entries
// under the users main entry, e.g.:
//
//  o=root
//   ou=people
//    uid=user@domain
//  mail=contact@contactdomain
//
// So the base_dn would be uid=%fu,ou=people,o=root
// The bind_dn would be the same as based_dn or some super user login.
/*
 * example config for Verisign directory
 *
\$config['ldap_public']['Verisign'] = [
  'name'          => 'Verisign.com',
  // Replacement variables supported in host names:
  // %h - user's IMAP hostname
  // %n - hostname ($_SERVER['SERVER_NAME'])
  // %t - hostname without the first part
  // %d - domain (http hostname $_SERVER['HTTP_HOST'] without the first part)
  // %z - IMAP domain (IMAP hostname without the first part)
  // For example %n = mail.domain.tld, %t = domain.tld
  // Note: Host can also be a full URI e.g. ldaps://hostname.local:636 (for SSL)
  'hosts'         => array('directory.verisign.com'),
  'port'          => 389,
  'use_tls'       => false,
  'ldap_version'  => 3,       // using LDAPv3
  'network_timeout' => 10,    // The timeout (in seconds) for connect + bind attempts. This is only supported in PHP >= 5.3.0 with OpenLDAP 2.x
  'user_specific' => false,   // If true the base_dn, bind_dn and bind_pass default to the user's IMAP login.
  // When 'user_specific' is enabled following variables can be used in base_dn/bind_dn config:
  // %fu - The full username provided, assumes the username is an email
  //       address, uses the username_domain value if not an email address.
  // %u  - The username prior to the '@'.
  // %d  - The domain name after the '@'.
  // %dc - The domain name hierarchal string e.g. "dc=test,dc=domain,dc=com"
  // %dn - DN found by ldap search when search_filter/search_base_dn are used
  'base_dn'       => '',
  'bind_dn'       => '',
  'bind_pass'     => '',
  // It's possible to bind for an individual address book
  // The login name is used to search for the DN to bind with
  'search_base_dn' => '',
  'search_filter'  => '',   // e.g. '(&(objectClass=posixAccount)(uid=%u))'
  // DN and password to bind as before searching for bind DN, if anonymous search is not allowed
  'search_bind_dn' => '',
  'search_bind_pw' => '',
  // Base DN and filter used for resolving the user's domain root DN which feeds the %dc variables
  // Leave empty to skip this lookup and derive the root DN from the username domain
  'domain_base_dn' => '',
  'domain_filter'  => '',
  // Optional map of replacement strings => attributes used when binding for an individual address book
  'search_bind_attrib' => [],  // e.g. ['%udc' => 'ou']
  // Default for %dn variable if search doesn't return DN value
  'search_dn_default' => '',
  // Optional authentication identifier to be used as SASL authorization proxy
  // bind_dn need to be empty
  'auth_cid'       => '',
  // SASL authentication method (for proxy auth), e.g. DIGEST-MD5
  'auth_method'    => '',
  // Indicates if the addressbook shall be hidden from the list.
  // With this option enabled you can still search/view contacts.
  'hidden'        => false,
  // Indicates if the addressbook shall not list contacts but only allows searching.
  'searchonly'    => false,
  // Indicates if we can write to the LDAP directory or not.
  // If writable is true then these fields need to be populated:
  // LDAP_Object_Classes, required_fields, LDAP_rdn
  'writable'       => false,
  // To create a new contact these are the object classes to specify
  // (or any other classes you wish to use).
  'LDAP_Object_Classes' => ['top', 'inetOrgPerson'],
  // The RDN field that is used for new entries, this field needs
  // to be one of the search_fields, the base of base_dn is appended
  // to the RDN to insert into the LDAP directory.
  'LDAP_rdn'       => 'cn',
  // The required fields needed to build a new contact as required by
  // the object classes (can include additional fields not required by the object classes).
  'required_fields' => ['cn', 'sn', 'mail'],
  'search_fields'   => ['mail', 'cn'],  // fields to search in
  // mapping of contact fields to directory attributes
  //   1. for every attribute one can specify the number of values (limit) allowed.
  //      default is 1, a wildcard * means unlimited
  //   2. another possible parameter is separator character for composite fields
  //   3. it's possible to define field format for write operations, e.g. for date fields
  //      example: 'birthday:date[YmdHis\\Z]'
  'fieldmap' => [
    // Roundcube  => LDAP:limit
    'name'        => 'cn',
    'surname'     => 'sn',
    'firstname'   => 'givenName',
    'jobtitle'    => 'title',
    'email'       => 'mail:*',
    'phone:home'  => 'homePhone',
    'phone:work'  => 'telephoneNumber',
    'phone:mobile' => 'mobile',
    'phone:pager' => 'pager',
    'phone:workfax' => 'facsimileTelephoneNumber',
    'street'      => 'street',
    'zipcode'     => 'postalCode',
    'region'      => 'st',
    'locality'    => 'l',
    // if you country is a complex object, you need to configure 'sub_fields' below
    'country'      => 'c',
    'organization' => 'o',
    'department'   => 'ou',
    'jobtitle'     => 'title',
    'notes'        => 'description',
    'photo'        => 'jpegPhoto',
    // these currently don't work:
    // 'manager'       => 'manager',
    // 'assistant'     => 'secretary',
  ],
  // Map of contact sub-objects (attribute name => objectClass(es)), e.g. 'c' => 'country'
  'sub_fields' => [],
  // Generate values for the following LDAP attributes automatically when creating a new record
  'autovalues' => [
    // 'uid'  => 'md5(microtime())',               // You may specify PHP code snippets which are then eval'ed
    // 'mail' => '{givenname}.{sn}@mydomain.com',  // or composite strings with placeholders for existing attributes
  ],
  'sort'           => 'cn',         // The field to sort the listing by.
  'scope'          => 'sub',        // search mode: sub|base|list
  'filter'         => '(objectClass=inetOrgPerson)',      // used for basic listing (if not empty) and will be &'d with search queries. example: status=act
  'fuzzy_search'   => true,         // server allows wildcard search
  'vlv'            => false,        // Enable Virtual List View to more efficiently fetch paginated data (if server supports it)
  'vlv_search'     => false,        // Use Virtual List View functions for autocompletion searches (if server supports it)
  'numsub_filter'  => '(objectClass=organizationalUnit)',   // with VLV, we also use numSubOrdinates to query the total number of records. Set this filter to get all numSubOrdinates attributes for counting
  'config_root_dn' => 'cn=config',  // Root DN to search config entries (e.g. vlv indexes)
  'sizelimit'      => '0',          // Enables you to limit the count of entries fetched. Setting this to 0 means no limit.
  'timelimit'      => '0',          // Sets the number of seconds how long is spend on the search. Setting this to 0 means no limit.
  'referrals'      => false,        // Sets the LDAP_OPT_REFERRALS option. Mostly used in multi-domain Active Directory setups
  'dereference'    => 0,            // Sets the LDAP_OPT_DEREF option. One of: LDAP_DEREF_NEVER, LDAP_DEREF_SEARCHING, LDAP_DEREF_FINDING, LDAP_DEREF_ALWAYS
                                    // Used where addressbook contains aliases to objects elsewhere in the LDAP tree.

  // definition for contact groups (uncomment if no groups are supported)
  // for the groups base_dn, the user replacements %fu, %u, %d and %dc work as for base_dn (see above)
  // if the groups base_dn is empty, the contact base_dn is used for the groups as well
  // -> in this case, assure that groups and contacts are separated due to the concerning filters!
  'groups'  => [
    'base_dn'           => '',
    'scope'             => 'sub',       // Search mode: sub|base|list
    'filter'            => '(objectClass=groupOfNames)',
    'object_classes'    => ['top', 'groupOfNames'],   // Object classes to be assigned to new groups
    'member_attr'       => 'member',   // Name of the default member attribute, e.g. uniqueMember
    'name_attr'         => 'cn',       // Attribute to be used as group name
    'email_attr'        => 'mail',     // Group email address attribute (e.g. for mailing lists)
    'member_filter'     => '(objectclass=*)',  // Optional filter to use when querying for group members
    'vlv'               => false,      // Use VLV controls to list groups
    'class_member_attr' => [      // Mapping of group object class to member attribute used in these objects
      'groupofnames'       => 'member',
      'groupofuniquenames' => 'uniquemember'
    ],
  ],
  // this configuration replaces the regular groups listing in the directory tree with
  // a hard-coded list of groups, each listing entries with the configured base DN and filter.
  // if the 'groups' option from above is set, it'll be shown as the first entry with the name 'Groups'
  'group_filters' => [
    'departments' => [
      'name'    => 'Company Departments',
      'scope'   => 'list',
      'base_dn' => 'ou=Groups,dc=mydomain,dc=com',
      'filter'  => '(|(objectclass=groupofuniquenames)(objectclass=groupofurls))',
      'name_attr' => 'cn',
    ],
    'customers' => [
      'name'    => 'Customers',
      'scope'   => 'sub',
      'base_dn' => 'ou=Customers,dc=mydomain,dc=com',
      'filter'  => '(objectClass=inetOrgPerson)',
      'name_attr' => 'sn',
    ],
  ],
];
*/

// An ordered array of the ids of the addressbooks that should be searched
// when populating address autocomplete fields server-side. ex: ['sql','Verisign'];
\$config['autocomplete_addressbooks'] = ['sql'];

// The minimum number of characters required to be typed in an autocomplete field
// before address books will be searched. Most useful for LDAP directories that
// may need to do lengthy results building given overly-broad searches
\$config['autocomplete_min_length'] = 1;

// Number of parallel autocomplete requests.
// If there's more than one address book, n parallel (async) requests will be created,
// where each request will search in one address book. By default (0), all address
// books are searched in one request.
\$config['autocomplete_threads'] = 0;

// Max. number of entries in autocomplete popup. Default: 15.
\$config['autocomplete_max'] = 15;

// show address fields in this order
// available placeholders: {street}, {locality}, {zipcode}, {country}, {region}
\$config['address_template'] = '{street}<br/>{locality} {zipcode}<br/>{country} {region}';

// Matching mode for addressbook search (including autocompletion)
// 0 - partial (*abc*), default
// 1 - strict (abc)
// 2 - prefix (abc*)
// Note: For LDAP sources fuzzy_search must be enabled to use 'partial' or 'prefix' mode
\$config['addressbook_search_mode'] = 0;

// List of fields used on contacts list and for autocompletion searches
// Warning: These are field names not LDAP attributes (see 'fieldmap' setting)!
\$config['contactlist_fields'] = ['name', 'firstname', 'surname', 'email'];

// Template of contact entry on the autocompletion list.
// You can use contact fields as: name, email, organization, department, etc.
// See program/steps/addressbook/func.inc for a list
\$config['contact_search_name'] = '{name} <{email}>';

// Contact mode. If your contacts are mostly business, switch it to 'business'.
// This will prioritize form fields related to 'work' (instead of 'home').
// Default: 'private'.
\$config['contact_form_mode'] = 'private';

// The addressbook source to store automatically collected recipients in.
// Default: true (the built-in "Collected recipients" addressbook, source id = '1')
// Note: It can be set to any writeable addressbook, e.g. 'sql'
\$config['collected_recipients'] = true;

// The addressbook source to store trusted senders in.
// Default: true (the built-in "Trusted senders" addressbook, source id = '2')
// Note: It can be set to any writeable addressbook, e.g. 'sql'
\$config['collected_senders'] = true;


// ----------------------------------
// USER PREFERENCES
// ----------------------------------

// Use this charset as fallback for message decoding
\$config['default_charset'] = 'ISO-8859-1';

// Skin name: folder from skins/
\$config['skin'] = 'elastic';

// Limit skins available for the user.
// Note: When not empty, it should include the default skin set in 'skin' option.
\$config['skins_allowed'] = [];

// Enables using standard browser windows (that can be handled as tabs)
// instead of popup windows
\$config['standard_windows'] = false;

// show up to X items in messages list view
\$config['mail_pagesize'] = 50;

// show up to X items in contacts list view
\$config['addressbook_pagesize'] = 50;

// sort contacts by this col (preferably either one of name, firstname, surname)
\$config['addressbook_sort_col'] = 'surname';

// The way how contact names are displayed in the list.
// 0: prefix firstname middlename surname suffix (only if display name is not set)
// 1: firstname middlename surname
// 2: surname firstname middlename
// 3: surname, firstname middlename
\$config['addressbook_name_listing'] = 0;

// use this timezone to display date/time
// valid timezone identifiers are listed here: php.net/manual/en/timezones.php
// 'auto' will use the browser's timezone settings
\$config['timezone'] = 'auto';

// prefer displaying HTML messages
\$config['prefer_html'] = true;

// Display remote resources (inline images, styles) in HTML messages
// 0 - Never, always ask
// 1 - Allow from my contacts (all writeable addressbooks + collected senders and recipients)
// 2 - Always allow
// 3 - Allow from trusted senders
\$config['show_images'] = 0;

// open messages in new window
\$config['message_extwin'] = false;

// open message compose form in new window
\$config['compose_extwin'] = false;

// compose html formatted messages by default
//  0 - never,
//  1 - always,
//  2 - on reply to HTML message,
//  3 - on forward or reply to HTML message
//  4 - always, except when replying to plain text message
\$config['htmleditor'] = 0;

// save copies of compose messages in the browser's local storage
// for recovery in case of browser crashes and session timeout.
\$config['compose_save_localstorage'] = true;

// show pretty dates as standard
\$config['prettydate'] = true;

// save compose message every 300 seconds (5min)
\$config['draft_autosave'] = 60;

// Interface layout. Default: 'widescreen'.
//  'widescreen' - three columns
//  'desktop'    - two columns, preview on bottom
//  'list'       - two columns, no preview
\$config['layout'] = 'widescreen';

// Mark as read when viewing a message (delay in seconds)
// Set to -1 if messages should not be marked as read
\$config['mail_read_time'] = 0;

// Clear Trash on logout
\$config['logout_purge'] = false;

// Compact INBOX on logout
\$config['logout_expunge'] = false;

// Display attached images below the message body
\$config['inline_images'] = true;

// Encoding of long/non-ascii attachment names:
// 0 - Full RFC 2231 compatible
// 1 - RFC 2047 for 'name' and RFC 2231 for 'filename' parameter (Thunderbird's default)
// 2 - Full 2047 compatible
\$config['mime_param_folding'] = 1;

// Set true if deleted messages should not be displayed
// This will make the application run slower
\$config['skip_deleted'] = false;

// Set true to Mark deleted messages as read as well as deleted
// False means that a message's read status is not affected by marking it as deleted
\$config['read_when_deleted'] = true;

// Set to true to never delete messages immediately
// Use 'Purge' to remove messages marked as deleted
\$config['flag_for_deletion'] = false;

// Default interval for auto-refresh requests (in seconds)
// These are requests for system state updates e.g. checking for new messages, etc.
// Setting it to 0 disables the feature.
\$config['refresh_interval'] = 60;

// If true all folders will be checked for recent messages
\$config['check_all_folders'] = false;

// If true, after message/contact delete/move, the next message/contact will be displayed
\$config['display_next'] = true;

// Default messages listing mode. One of 'threads' or 'list'.
\$config['default_list_mode'] = 'list';

// 0 - Do not expand threads
// 1 - Expand all threads automatically
// 2 - Expand only threads with unread messages
\$config['autoexpand_threads'] = 0;

// When replying:
// -1 - don't cite the original message
// 0  - place cursor below the original message
// 1  - place cursor above original message (top posting)
// 2  - place cursor above original message (top posting), but do not indent the quote
\$config['reply_mode'] = 1;

// When replying strip original signature from message
\$config['strip_existing_sig'] = true;

// Show signature:
// 0 - Never
// 1 - Always
// 2 - New messages only
// 3 - Forwards and Replies only
\$config['show_sig'] = 1;

// By default the signature is placed depending on cursor position (reply_mode).
// Sometimes it might be convenient to start the reply on top but keep
// the signature below the quoted text (sig_below = true).
\$config['sig_below'] = false;

// Enables adding of standard separator to the signature
\$config['sig_separator'] = true;

// Use MIME encoding (quoted-printable) for 8bit characters in message body
\$config['force_7bit'] = false;

// Default fields configuration for mail search.
// The array can contain a per-folder list of header fields which should be considered when searching
// The entry with key '*' stands for all folders which do not have a specific list set.
// Supported fields: subject, from, to, cc, bcc, body, text.
// Please note that folder names should to be in sync with \$config['*_mbox'] options
\$config['search_mods'] = null;  // Example: ['*' => ['subject'=>1, 'from'=>1], 'Sent' => ['subject'=>1, 'to'=>1]];

// Defaults of the addressbook search field configuration.
\$config['addressbook_search_mods'] = null;  // Example: ['name'=>1, 'firstname'=>1, 'surname'=>1, 'email'=>1, '*'=>1];

// Directly delete messages in Junk instead of moving to Trash
\$config['delete_junk'] = false;

// Behavior if a received message requests a message delivery notification (read receipt)
// 0 = ask the user,
// 1 = send automatically,
// 2 = ignore (never send or ask)
// 3 = send automatically if sender is in my contacts, otherwise ask the user
// 4 = send automatically if sender is in my contacts, otherwise ignore
// 5 = send automatically if sender is a trusted sender, otherwise ask the user
// 6 = send automatically if sender is a trusted sender, otherwise ignore
\$config['mdn_requests'] = 0;

// Return receipt checkbox default state
\$config['mdn_default'] = 0;

// Delivery Status Notification checkbox default state
// Note: This can be used only if smtp_server is non-empty
\$config['dsn_default'] = 0;

// Place replies in the folder of the message being replied to
\$config['reply_same_folder'] = false;

// Sets default mode of Forward feature to "forward as attachment"
\$config['forward_attachment'] = false;

// Defines address book (internal index) to which new contacts will be added
// By default it is the first writeable addressbook.
// Note: Use '0' for built-in address book.
\$config['default_addressbook'] = null;

// Enables spell checking before sending a message.
\$config['spellcheck_before_send'] = false;

// Skip alternative email addresses in autocompletion (show one address per contact)
\$config['autocomplete_single'] = false;

// Default font for composed HTML message.
// Supported values: Andale Mono, Arial, Arial Black, Book Antiqua, Courier New,
// Georgia, Helvetica, Impact, Tahoma, Terminal, Times New Roman, Trebuchet MS, Verdana
\$config['default_font'] = 'Verdana';

// Default font size for composed HTML message.
// Supported sizes: 8pt, 10pt, 12pt, 14pt, 18pt, 24pt, 36pt
\$config['default_font_size'] = '12pt';

// Enables display of email address with name instead of a name (and address in title)
\$config['message_show_email'] = false;

// Default behavior of Reply-All button:
// 0 - Reply-All always
// 1 - Reply-List if mailing list is detected
\$config['reply_all_mode'] = 0;

EOF

echo "Configuring CeyWebmail"
sleep 2s

mv defaults.inc.php config.inc.php config/

# End downloading & configuring webmail

# Create MySQL Database

if [[ -z $mysqlpw ]]; then

	mysql -u root <<EOF
		DROP DATABASE IF EXISTS \`$wmdb\`;
		CREATE DATABASE \`$wmdb\`;
		GRANT ALL ON \`$wmdb\`.* TO '$wmdbuser'@'localhost' IDENTIFIED BY '$wmdbpass';
		FLUSH PRIVILEGES;
EOF
	mysql $wmdb < SQL/mysql.initial.sql > /dev/null 2>&1

elif [[ $mysqlpw == 'none' ]]; then

	mysql -u root <<EOF
		DROP DATABASE IF EXISTS \`$wmdb\`;
		CREATE DATABASE \`$wmdb\`;
		GRANT ALL ON \`$wmdb\`.* TO '$wmdbuser'@'localhost' IDENTIFIED BY '$wmdbpass';
		FLUSH PRIVILEGES;
EOF
	mysql $wmdb < SQL/mysql.initial.sql > /dev/null 2>&1

elif [[ ! $mysqlpw == 'none' ]]; then

	mysql -u root -p$mysqlpw <<EOF
		DROP DATABASE IF EXISTS \`$wmdb\`;
		CREATE DATABASE \`$wmdb\`;
		GRANT ALL ON \`$wmdb\`.* TO '$wmdbuser'@'localhost' IDENTIFIED BY '$wmdbpass';
		FLUSH PRIVILEGES;
EOF
	mysql $wmdb -p$mysqlpw < SQL/mysql.initial.sql > /dev/null 2>&1
fi

rm -r $ceymail_dir/installer

# End Create MySQL Database

#Apache Configuration

cd /etc/apache2/sites-available/
apache_site_config=$precedingceymail'.'$wmsitename'.conf'
sleep 1s
if [[ -e $apache_site_config ]]; then
	echo "$apache_site_config already exists."
	read -p "Remove and re-create? [y or n]:: " a2dis

	if [[ $a2dis == 'y' || $a2dis == 'yes' ]]; then
		a2dissite $precedingceymail'.'$wmsitename*
		rm $precedingceymail'.'$wmsitename*

	elif [[ $a2dis == 'n' || $a2dis == 'no' ]]; then
		:

	else
		echo "Invalid input. Please try again."
        exit 0
	fi

fi


cat <<EOF > $apache_site_config
<VirtualHost *:80>
        ServerName $ceydomain
        ServerAdmin $adminemail
        DocumentRoot $ceymail_dir
        ErrorLog ${APACHE_LOG_DIR}/error.log
        CustomLog ${APACHE_LOG_DIR}/access.log combined
</VirtualHost>

<Directory $ceymail_dir>
         Options Indexes FollowSymLinks
         AllowOverride All
         Require all granted
</Directory>
EOF

a2ensite $apache_site_config 2>/dev/null
service apache2 restart 2>/dev/null
certbot run -n --apache --agree-tos -d $wmdomain,www.$wmdomain -m $adminemail --redirect 2>/dev/null
sleep 2s
certbot run -n --apache --agree-tos -d $ceydomain -m $adminemail --redirect 2>/dev/null
cp -r /etc/letsencrypt/live/$wmdomain* /etc/letsencrypt/live/mail
service apache2 restart 2>/dev/null

# End apache configuration



cd ~/

# End Webmail

	#Restarting All Services
	service postfix restart
	service dovecot restart
	service opendkim restart
	service apache2 restart
	service mariadb restart
	service spamassassin restart


#Setting Permissions
chown postfix:postfix /var/lib/postfix/* >/dev/null
chown opendkim:postfix /var/spool/postfix/opendkim >/dev/null
chmod 600 /var/lib/postfix/* >/dev/null
chmod 2755 /usr/sbin/postdrop >/dev/null
postfix set-permissions >/dev/null
chown -R root:root /etc/postfix >/dev/null
chown -R opendkim:opendkim /etc/opendkim >/dev/null
gpasswd -a postfix opendkim >/dev/null
gpasswd -a vmail dovecot >/dev/null
gpasswd -a vmail mail >/dev/null
chown -R vmail:dovecot /etc/dovecot >/dev/null
chmod -R 0751 /etc/dovecot >/dev/null
chown -R mail:mail /etc/dovecot/sieve >/dev/null
chown -R vmail:vmail /var/mail/vhosts >/dev/null
chown -R www-data:www-data /var/www/html >/dev/null
chown -R spamd:spamd /var/log/spamassassin


#Restarting All Services
service postfix restart
service dovecot restart
service opendkim restart
service apache2 restart
service mariadb restart
service spamassassin restart

echo ""
echo "CeyWebmail has been installed!"
echo "You can login now at $ceydomain."
echo ""

#End Configuration

fi

echo "CeyMail has successfully been configured. Add new domains to automatically generate DKIM keys."

}


generate_dkim(){

read -p "Please enter domain name: " domain

if [[ $domain = exit ]]; then
	return

elif [[ $domain = e ]]; then
	return

fi

if [[ -e /etc/mail/dkim-keys/$domain ]]; then
	echo "Domain already exists!"
	read -p "Delete domain? (y/n): " dd

	if [[ $dd = y ]]; then
		rm -rf /etc/mail/dkim-keys/$domain
		cp -r /etc/opendkim ~/ceymail/opendkim.bak
		grep -v "$domain" /etc/opendkim/key.table > tmp && mv tmp /etc/opendkim/key.table
		grep -v "$domain" /etc/opendkim/signing.table > tmp && mv tmp /etc/opendkim/signing.table
		grep -v "$domain" /etc/opendkim/trusted.hosts > tmp && mv tmp /etc/opendkim/trusted.hosts

	elif [[ $dd = n ]]; then
		return

	else
		echo "Your input is incorrect"
		return
	fi
fi

if [[ ! -e ~/ceymail ]]; then
	mkdir ~/ceymail
fi

echo "Generating DKIM"
mkdir -p /etc/mail/dkim-keys/$domain
cd /etc/mail/dkim-keys/$domain
opendkim-genkey -s mail -d $domain
mv mail.private $domain.private
mv mail.txt	$domain.txt
cp /etc/mail/dkim-keys/$domain/$domain.txt ~/ceymail/$domain.txt

cd /etc/opendkim

cat <<EOF >> key.table
mail._domainkey.$domain	$domain:mail:/etc/mail/dkim-keys/$domain/$domain.private
EOF

cat <<EOF >> signing.table
*@$domain  		mail._domainkey.$domain
EOF

cat <<EOF >> trusted.hosts
$domain
EOF

#Setting Permissions
chown -R opendkim:opendkim /etc/mail/dkim-keys >/dev/null
chown -R opendkim:opendkim /etc/opendkim >/dev/null
chmod -R 700 /etc/mail/dkim-keys >/dev/null
service opendkim restart

echo ""
echo "Your DKIM Signature can be found at ~/ceymail/$domain.txt"

menu
}

fix_permissions(){

	#Setting Permissions
	chown postfix:postfix /var/lib/postfix/* >/dev/null
	chown opendkim:postfix /var/spool/postfix/opendkim >/dev/null
	chmod 600 /var/lib/postfix/* >/dev/null
	chmod 2755 /usr/sbin/postdrop >/dev/null
	postfix set-permissions >/dev/null
	chown -R root:root /etc/postfix >/dev/null
	chown -R opendkim:opendkim /etc/opendkim >/dev/null
	gpasswd -a postfix opendkim >/dev/null
	gpasswd -a vmail dovecot >/dev/null
	gpasswd -a vmail mail >/dev/null
	chown -R vmail:dovecot /etc/dovecot >/dev/null
	chmod -R 0751 /etc/dovecot >/dev/null
	chown -R mail:mail /etc/dovecot/sieve >/dev/null
	chown -R vmail:vmail /var/mail/vhosts >/dev/null
	chown -R www-data:www-data /var/www/html >/dev/null
	chown -R spamd:spamd /var/log/spamassassin

	#Restarting All Services with systemctl
	systemctl restart postfix
	systemctl restart dovecot
	systemctl restart opendkim
	systemctl restart apache2
	systemctl restart mariadb
	systemctl restart spamassassin

	echo "All permissions have been fixed and services restarted."
	menu
}

clear_postfix_queue(){
	postsuper -d ALL
	sleep 1s
	echo "Your mail queue has been cleared!"
	echo ""
	menu
}

uninstall(){
spamassassinlocation=/etc/spamassassin
dovecotlocation=/etc/dovecot
postfixlocation=/etc/postfix
mysqllocation=/var/lib/mysql
opendkimlocation=/etc/opendkim.conf

read -p "Are you sure you want to uninstall CeyMail? (y/n): " unans
if [[ $unans = y ]]; then
echo "Uninstalling CeyMail"

echo "Disabling automatic updates..."

grep -v "0 */12 * * * root /ceymail/update" /etc/crontab > tmp && mv tmp /etc/crontab

pkill vmail
pkill opendkim
pkill postfix
pkill policyd-spf
pkill debian-spamd
pkill spamd
apt remove --purge opendkim opendkim-tools spamassassin spamc mariadb-server postfix postfix-mysql postfix-policyd-spf-python postfix-pcre dovecot-common dovecot-imapd dovecot-pop3d dovecot-core dovecot-sieve dovecot-lmtpd dovecot-mysql -y

if id "vmail" >/dev/null 2>&1; then
	userdel -f vmail
fi
if id "opendkim" >/dev/null 2>&1; then
	userdel -f opendkim
fi
if id "postfix" >/dev/null 2>&1; then
	userdel -f postfix
fi
if id "policyd-spf" >/dev/null 2>&1; then
	userdel -f policyd-spf
fi
if id "debian-spamd" >/dev/null 2>&1; then
	userdel -f debian-spamd
fi
if id "spamd" >/dev/null 2>&1; then
	userdel -f spamd
fi


rm /usr/local/bin/ceymail
rm -rf /ceymail /etc/dovecot /etc/postfix /etc/opendkim /etc/opendkim.conf /etc/mail/dkim-keys

	read -p "Delete Email Database? (y/n): " mysqlans
	if [[ $mysqlans = n ]]; then
		exit 0
	elif [[ $mysqlans = y ]]; then
		mysql -u root -e "DROP DATABASE \`$db\`;"
		echo "Database Deleted"
		echo "CeyMail Uninstalled"
		exit 0
	else
		echo "Your input is incorrect"
		read -p "Delete Email Database? (y/n): " mysqlans
	if [[ $mysqlans = n ]]; then
		exit 0
	elif [[ $mysqlans = y ]]; then
		mysql -u root -e "DROP DATABASE \`$db\`;"
		echo "Database Deleted"
		echo "CeyMail Uninstalled"
		exit 0
	fi
	fi
	while [[ $mysqlans = "" ]]; do
		echo "You haven't entered an input."
		read -p "Delete Email Database? (y/n): " mysqlans
	if [[ $mysqlans = n ]]; then
		exit 0
	elif [[ $mysqlans = y ]]; then
		mysql -u root -e "DROP DATABASE \`$db\`;"
		echo "Database Deleted"
		echo "CeyMail Uninstalled"
		exit 0
	else
		echo "Your input is incorrect."
	fi
	done

		echo "CeyMail Uninstalled"
exit 0


elif [[ $unans = n ]]; then
	echo "Goodbye!"
	return

else
	echo "Your input is incorrect!"
	return
fi

}

view_mail_log(){
	tail -n 50 /var/log/mail.log
	menu
}

menu(){

pi=99
pa="1. Configure CeyMail"
pb="2. Manage CeyMail"
pwm="3. Install & Configure Webmail"
pl="4. Generate DKIM Keys"
pg="5. Fix Permissions"
pz="6. Backup"
update="7. Check For Updates"
pu="8. Uninstall CeyMail"
plog="9. Setup Enhanced Logging"
pdns="10. Setup Unbound DNS Resolver"
ptest="11. Test DNSBL Functionality"
updatelog="Enter 'u' to View Update Log"
maillog="Enter 'm' to View Mail Log."
cpq="Enter 'c' to Clear Mail Queue"
px="Enter 'e' or 'exit' to Exit."

checkUpdate=/ceymail/update

while [[ $pi -gt 0 ]]; do
echo ""
printf "CeyMail Menu\n-------------"
echo ""
echo ""
echo $pa
echo $pb
echo $pwm
echo $pl
echo $pg
echo $pz
echo $update
echo $pu
echo $plog
echo $pdns
echo $ptest
echo ""
echo $updatelog
echo $maillog
echo $cpq
echo $px
echo ""
read -p "Enter an option: " pans

while [[ $pans = "" ]]; do
	echo "You haven't entered an input."
	read -p "Enter an option: " pans
	if [[ $pans = exit ]]; then
	exit 0
	elif [[ $pans = e ]]; then
	exit 0
	fi
done

if [[ $pans = 1 ]]; then
	configure

elif [[ $pans = 2 ]]; then
	manage

elif [[ $pans = 3 ]]; then
	ceywebmail

elif [[ $pans = 4 ]]; then
	generate_dkim

elif [[ $pans = 5 ]]; then
	fix_permissions

elif [[ $pans = 6 ]]; then
	backup

elif [[ $pans = 7 ]]; then
	source $checkUpdate
	
elif [[ $pans = 8 ]]; then
	uninstall

elif [[ $pans = 9 ]]; then
	setup_enhanced_logging

elif [[ $pans = 10 ]]; then
	setup_unbound_dns

elif [[ $pans = 11 ]]; then
	test_dnsbl_functionality

elif [[ $pans = u ]]; then
	viewupdatelog

elif [[ $pans = c ]]; then
	clear_postfix_queue

elif [[ $pans = m ]]; then
	view_mail_log

elif [[ $pans = e || $pans = 'exit' ]]; then
	exit 0

else
	echo "Your input is incorrect!"
	exit 0

fi
(( pi-- ))
done

}

menu

setup_enhanced_logging(){
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
	
	# Configure Dovecot detailed logging
	if [ -f /etc/dovecot/conf.d/10-logging.conf ]; then
		cp /etc/dovecot/conf.d/10-logging.conf /etc/dovecot/conf.d/10-logging.conf.bak
		cat > /etc/dovecot/conf.d/10-logging.conf << 'EOF'
log_path = /var/log/dovecot.log
info_log_path = /var/log/dovecot-info.log
log_timestamp = "%Y-%m-%d %H:%M:%S "
EOF
		touch /var/log/dovecot.log /var/log/dovecot-info.log
		chmod 640 /var/log/dovecot*.log
	fi
	
	# Enable and restart rsyslog
	systemctl enable rsyslog
	systemctl restart rsyslog
	
	echo "Enhanced mail logging configured successfully."
	menu
}

setup_unbound_dns(){
	echo "Installing and configuring Unbound DNS resolver for DNSBL protection..."
	
	# Install Unbound
	apt install -y unbound
	
	# Backup original resolv.conf
	[ -f /etc/resolv.conf ] && cp /etc/resolv.conf /etc/resolv.conf.bak
	
	# Configure Unbound as local resolver
	echo "nameserver 127.0.0.1" > /etc/resolv.conf
	
	# Configure systemd-resolved if present
	if systemctl is-active --quiet systemd-resolved; then
		echo "Configuring systemd-resolved to use Unbound..."
		mkdir -p /etc/systemd/resolved.conf.d
		cat > /etc/systemd/resolved.conf.d/unbound.conf << 'EOF'
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
	menu
}

test_dnsbl_functionality(){
	echo "Testing DNSBL functionality..."
	
	# Install dnsutils if not present
	apt install -y dnsutils
	
	echo "Testing DNS resolution through Unbound..."
	if dig zen.spamhaus.org @127.0.0.1 +short | grep -q "127.0.0"; then
		echo "✅ Unbound DNS resolver is working correctly"
	else
		echo "⚠️  Warning: Unbound DNS resolver may not be working properly"
	fi
	
	echo "Checking Postfix DNSBL configuration..."
	if postconf | grep -q "zen.spamhaus.org"; then
		echo "✅ Postfix DNSBL configuration found"
	else
		echo "⚠️  Warning: Postfix DNSBL configuration not found"
	fi
	
	echo "Current mail queue status:"
	postqueue -p
	
	echo ""
	echo "Recent mail log entries:"
	tail -n 10 /var/log/mail.log 2>/dev/null || echo "Mail log not found"
	
	echo ""
	read -p "Press Enter to continue..." dummy
	menu
}

view_mail_log(){
	tail -n 50 /var/log/mail.log
	menu
}