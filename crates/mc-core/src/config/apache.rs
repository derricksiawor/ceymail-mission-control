use std::fmt;

/// Configuration for an Apache virtual host.
#[derive(Debug, Clone)]
pub struct VhostConfig {
    /// The primary ServerName (e.g. "webmail.example.com").
    pub server_name: String,
    /// ServerAdmin email.
    pub server_admin: String,
    /// Document root path.
    pub document_root: String,
    /// Optional server aliases.
    pub server_aliases: Vec<String>,
    /// Path to SSL certificate (fullchain). If None, no SSL block is generated.
    pub ssl_cert: Option<String>,
    /// Path to SSL key.
    pub ssl_key: Option<String>,
    /// Whether to add an HTTP->HTTPS redirect vhost on port 80.
    pub redirect_http_to_https: bool,
    /// Optional extra directives to add inside the <VirtualHost> block.
    pub extra_directives: Vec<String>,
}

#[derive(Debug)]
pub enum ApacheConfigError {
    MissingSslKey,
    MissingSslCert,
}

impl fmt::Display for ApacheConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingSslKey => write!(f, "SSL cert provided but key is missing"),
            Self::MissingSslCert => write!(f, "SSL key provided but cert is missing"),
        }
    }
}

impl std::error::Error for ApacheConfigError {}

impl VhostConfig {
    /// Validate the configuration.
    pub fn validate(&self) -> Result<(), ApacheConfigError> {
        match (&self.ssl_cert, &self.ssl_key) {
            (Some(_), None) => Err(ApacheConfigError::MissingSslKey),
            (None, Some(_)) => Err(ApacheConfigError::MissingSslCert),
            _ => Ok(()),
        }
    }
}

/// Generate a secure Apache vhost configuration.
///
/// Key security improvements over the bash scripts:
///   - `AllowOverride None` instead of `AllowOverride All`
///   - Security headers (X-Frame-Options, X-Content-Type-Options, etc.)
///   - Proper SSL configuration with modern ciphers
pub fn generate_vhost(config: &VhostConfig) -> Result<String, ApacheConfigError> {
    config.validate()?;

    let mut out = String::new();

    // HTTP redirect if SSL is enabled
    if config.redirect_http_to_https && config.ssl_cert.is_some() {
        out.push_str(&format!(
            "\
<VirtualHost *:80>
    ServerName {server_name}
{aliases}\
    ServerAdmin {server_admin}

    # Redirect all HTTP traffic to HTTPS
    RewriteEngine On
    RewriteCond %{{HTTPS}} off
    RewriteRule ^ https://%{{HTTP_HOST}}%{{REQUEST_URI}} [L,R=301]
</VirtualHost>

",
            server_name = config.server_name,
            server_admin = config.server_admin,
            aliases = format_aliases(&config.server_aliases, "    "),
        ));
    }

    let port = if config.ssl_cert.is_some() {
        "443"
    } else {
        "80"
    };

    out.push_str(&format!(
        "\
<VirtualHost *:{port}>
    ServerName {server_name}
{aliases}\
    ServerAdmin {server_admin}
    DocumentRoot {document_root}

    <Directory {document_root}>
        Options -Indexes +FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    # Security headers
    Header always set X-Frame-Options \"SAMEORIGIN\"
    Header always set X-Content-Type-Options \"nosniff\"
    Header always set X-XSS-Protection \"1; mode=block\"
    Header always set Referrer-Policy \"strict-origin-when-cross-origin\"
    Header always set Permissions-Policy \"geolocation=(), microphone=(), camera=()\"

    # Logging
    ErrorLog ${{APACHE_LOG_DIR}}/{server_name_escaped}-error.log
    CustomLog ${{APACHE_LOG_DIR}}/{server_name_escaped}-access.log combined
",
        port = port,
        server_name = config.server_name,
        aliases = format_aliases(&config.server_aliases, "    "),
        server_admin = config.server_admin,
        document_root = config.document_root,
        server_name_escaped = config.server_name.replace('.', "_"),
    ));

    // SSL block
    if let (Some(cert), Some(key)) = (&config.ssl_cert, &config.ssl_key) {
        out.push_str(&format!(
            "\
\n    # SSL configuration
    SSLEngine on
    SSLCertificateFile {cert}
    SSLCertificateKeyFile {key}

    # Modern TLS settings
    SSLProtocol all -SSLv2 -SSLv3 -TLSv1 -TLSv1.1
    SSLHonorCipherOrder on
    SSLCompression off

    # HSTS (1 year)
    Header always set Strict-Transport-Security \"max-age=31536000; includeSubDomains\"
",
            cert = cert,
            key = key,
        ));
    }

    // Extra directives
    for directive in &config.extra_directives {
        out.push_str(&format!("\n    {}\n", directive));
    }

    out.push_str("</VirtualHost>\n");

    Ok(out)
}

/// Generate a webmail (Roundcube) virtual host configuration.
pub fn generate_webmail_vhost(
    domain: &str,
    site_name: &str,
    admin_email: &str,
) -> Result<String, ApacheConfigError> {
    let hostname = format!("webmail.{}", domain);
    let config = VhostConfig {
        server_name: hostname.clone(),
        server_admin: admin_email.to_string(),
        document_root: "/var/lib/roundcube/public_html".to_string(),
        server_aliases: Vec::new(),
        ssl_cert: Some(format!(
            "/etc/letsencrypt/live/{}/fullchain.pem",
            hostname
        )),
        ssl_key: Some(format!(
            "/etc/letsencrypt/live/{}/privkey.pem",
            hostname
        )),
        redirect_http_to_https: true,
        extra_directives: vec![
            format!("# {} webmail", site_name),
            // PHP-FPM proxy for Roundcube
            "<FilesMatch \\.php$>".to_string(),
            "    SetHandler \"proxy:unix:/run/php/php-fpm.sock|fcgi://localhost\"".to_string(),
            "</FilesMatch>".to_string(),
        ],
    };

    generate_vhost(&config)
}

/// Helper to format ServerAlias lines.
fn format_aliases(aliases: &[String], indent: &str) -> String {
    let mut out = String::new();
    for alias in aliases {
        out.push_str(&format!("{}ServerAlias {}\n", indent, alias));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basic_config() -> VhostConfig {
        VhostConfig {
            server_name: "example.com".to_string(),
            server_admin: "admin@example.com".to_string(),
            document_root: "/var/www/example".to_string(),
            server_aliases: vec!["www.example.com".to_string()],
            ssl_cert: None,
            ssl_key: None,
            redirect_http_to_https: false,
            extra_directives: Vec::new(),
        }
    }

    fn ssl_config() -> VhostConfig {
        VhostConfig {
            server_name: "example.com".to_string(),
            server_admin: "admin@example.com".to_string(),
            document_root: "/var/www/example".to_string(),
            server_aliases: Vec::new(),
            ssl_cert: Some("/etc/ssl/cert.pem".to_string()),
            ssl_key: Some("/etc/ssl/key.pem".to_string()),
            redirect_http_to_https: true,
            extra_directives: Vec::new(),
        }
    }

    #[test]
    fn test_basic_vhost() {
        let out = generate_vhost(&basic_config()).unwrap();
        assert!(out.contains("<VirtualHost *:80>"));
        assert!(out.contains("ServerName example.com"));
        assert!(out.contains("ServerAlias www.example.com"));
        assert!(out.contains("DocumentRoot /var/www/example"));
    }

    #[test]
    fn test_allow_override_none() {
        let out = generate_vhost(&basic_config()).unwrap();
        assert!(out.contains("AllowOverride None"));
        assert!(!out.contains("AllowOverride All"));
    }

    #[test]
    fn test_security_headers() {
        let out = generate_vhost(&basic_config()).unwrap();
        assert!(out.contains("X-Frame-Options"));
        assert!(out.contains("X-Content-Type-Options"));
        assert!(out.contains("X-XSS-Protection"));
        assert!(out.contains("Referrer-Policy"));
        assert!(out.contains("Permissions-Policy"));
    }

    #[test]
    fn test_no_directory_listing() {
        let out = generate_vhost(&basic_config()).unwrap();
        assert!(out.contains("-Indexes"));
    }

    #[test]
    fn test_ssl_vhost() {
        let out = generate_vhost(&ssl_config()).unwrap();
        assert!(out.contains("<VirtualHost *:443>"));
        assert!(out.contains("SSLEngine on"));
        assert!(out.contains("SSLCertificateFile /etc/ssl/cert.pem"));
        assert!(out.contains("SSLCertificateKeyFile /etc/ssl/key.pem"));
        assert!(out.contains("-SSLv2"));
        assert!(out.contains("-SSLv3"));
        assert!(out.contains("-TLSv1.1"));
        assert!(out.contains("Strict-Transport-Security"));
    }

    #[test]
    fn test_http_to_https_redirect() {
        let out = generate_vhost(&ssl_config()).unwrap();
        // Should have an HTTP vhost for redirect
        assert!(out.contains("<VirtualHost *:80>"));
        assert!(out.contains("RewriteEngine On"));
        assert!(out.contains("R=301"));
    }

    #[test]
    fn test_no_redirect_without_ssl() {
        let config = basic_config();
        let out = generate_vhost(&config).unwrap();
        assert!(!out.contains("RewriteEngine"));
    }

    #[test]
    fn test_validate_mismatched_ssl() {
        let mut config = basic_config();
        config.ssl_cert = Some("/etc/ssl/cert.pem".to_string());
        // No key
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_webmail_vhost() {
        let out = generate_webmail_vhost("example.com", "CeyMail", "admin@example.com").unwrap();
        assert!(out.contains("ServerName webmail.example.com"));
        assert!(out.contains("DocumentRoot /var/lib/roundcube/public_html"));
        assert!(out.contains("SSLEngine on"));
        assert!(out.contains("php-fpm"));
        assert!(out.contains("AllowOverride None"));
        assert!(out.contains("X-Frame-Options"));
    }

    #[test]
    fn test_extra_directives() {
        let mut config = basic_config();
        config.extra_directives = vec!["ProxyPass / http://localhost:3000/".to_string()];
        let out = generate_vhost(&config).unwrap();
        assert!(out.contains("ProxyPass / http://localhost:3000/"));
    }

    #[test]
    fn test_logging_paths() {
        let out = generate_vhost(&basic_config()).unwrap();
        assert!(out.contains("example_com-error.log"));
        assert!(out.contains("example_com-access.log"));
    }
}
