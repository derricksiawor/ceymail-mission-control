use std::fmt;

/// Roundcube config.inc.php configuration.
///
/// This generator is designed to be safe against PHP injection and
/// SQL injection. All user-supplied values are escaped using
/// `php_escape()` which handles PHP single-quoted string context.
#[derive(Debug, Clone)]
pub struct RoundcubeConfig {
    /// Database type (default "mysql").
    pub db_type: String,
    /// Database host.
    pub db_host: String,
    /// Database name.
    pub db_name: String,
    /// Database user.
    pub db_user: String,
    /// Database password.
    pub db_password: String,
    /// IMAP host (e.g. "ssl://mail.example.com").
    pub imap_host: String,
    /// IMAP port (default 993).
    pub imap_port: u16,
    /// SMTP host (e.g. "tls://mail.example.com").
    pub smtp_host: String,
    /// SMTP port (default 587).
    pub smtp_port: u16,
    /// Product name shown in the UI.
    pub product_name: String,
    /// Support / admin email.
    pub admin_email: String,
    /// DES key for session encryption (must be exactly 24 chars).
    pub des_key: String,
    /// Default language.
    pub language: String,
    /// Skin name.
    pub skin: String,
    /// Whether to verify IMAP TLS certificates.
    pub imap_verify_tls: bool,
    /// Whether to verify SMTP TLS certificates.
    pub smtp_verify_tls: bool,
}

#[derive(Debug)]
pub enum RoundcubeConfigError {
    InvalidDesKeyLength(usize),
    EmptyField(String),
}

impl fmt::Display for RoundcubeConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDesKeyLength(len) => {
                write!(f, "des_key must be exactly 24 characters, got {}", len)
            }
            Self::EmptyField(name) => write!(f, "Required field '{}' is empty", name),
        }
    }
}

impl std::error::Error for RoundcubeConfigError {}

/// Safely escape a string for use in PHP single-quoted context.
///
/// In PHP single-quoted strings, only two escapes are recognized:
///   \' -> literal single quote
///   \\ -> literal backslash
///
/// This function escapes both backslashes and single quotes.
pub fn php_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            other => out.push(other),
        }
    }
    out
}

/// Generate a random 24-character DES key suitable for Roundcube.
/// Uses alphanumeric plus a set of safe punctuation characters.
pub fn generate_des_key() -> String {
    use rand::Rng;
    const CHARSET: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_+=";
    let mut rng = rand::thread_rng();
    (0..24)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

impl RoundcubeConfig {
    /// Generate a config with secure defaults for the given domain.
    pub fn generate_default(domain: &str, admin_email: &str) -> Self {
        Self {
            db_type: "mysql".to_string(),
            db_host: "localhost".to_string(),
            db_name: "roundcubemail".to_string(),
            db_user: "roundcube".to_string(),
            db_password: "changeme".to_string(),
            imap_host: format!("ssl://mail.{}", domain),
            imap_port: 993,
            smtp_host: format!("tls://mail.{}", domain),
            smtp_port: 587,
            product_name: "CeyMail".to_string(),
            admin_email: admin_email.to_string(),
            des_key: generate_des_key(),
            language: "en_US".to_string(),
            skin: "elastic".to_string(),
            imap_verify_tls: true,
            smtp_verify_tls: true,
        }
    }

    /// Validate the config before generation.
    pub fn validate(&self) -> Result<(), RoundcubeConfigError> {
        if self.des_key.len() != 24 {
            return Err(RoundcubeConfigError::InvalidDesKeyLength(
                self.des_key.len(),
            ));
        }
        if self.db_name.is_empty() {
            return Err(RoundcubeConfigError::EmptyField("db_name".to_string()));
        }
        if self.db_user.is_empty() {
            return Err(RoundcubeConfigError::EmptyField("db_user".to_string()));
        }
        if self.imap_host.is_empty() {
            return Err(RoundcubeConfigError::EmptyField("imap_host".to_string()));
        }
        if self.smtp_host.is_empty() {
            return Err(RoundcubeConfigError::EmptyField("smtp_host".to_string()));
        }
        Ok(())
    }
}

/// Generate the config.inc.php content from a validated RoundcubeConfig.
///
/// All values are escaped via `php_escape()` so that user input cannot
/// break out of PHP string literals. The DB DSN is constructed by
/// concatenating escaped components, never via raw string interpolation
/// of unsanitized input.
///
/// This fixes the bash script bugs:
///   - `imap_conn_options` had a `null` override that disabled TLS verification
///   - `admin_email` was hardcoded to help@derkonline.com
pub fn generate_config_inc_php(
    config: &RoundcubeConfig,
) -> Result<String, RoundcubeConfigError> {
    config.validate()?;

    // Build the DSN with individually escaped components
    let dsn = format!(
        "{}://{}:{}@{}/{}",
        php_escape(&config.db_type),
        php_escape(&config.db_user),
        php_escape(&config.db_password),
        php_escape(&config.db_host),
        php_escape(&config.db_name),
    );

    let imap_conn_opts = if config.imap_verify_tls {
        "\
$config['imap_conn_options'] = array(
    'ssl' => array(
        'verify_peer'       => true,
        'verify_peer_name'  => true,
        'allow_self_signed' => false,
    ),
);"
    } else {
        "\
$config['imap_conn_options'] = array(
    'ssl' => array(
        'verify_peer'       => false,
        'verify_peer_name'  => false,
        'allow_self_signed' => true,
    ),
);"
    };

    let smtp_conn_opts = if config.smtp_verify_tls {
        "\
$config['smtp_conn_options'] = array(
    'ssl' => array(
        'verify_peer'       => true,
        'verify_peer_name'  => true,
        'allow_self_signed' => false,
    ),
);"
    } else {
        "\
$config['smtp_conn_options'] = array(
    'ssl' => array(
        'verify_peer'       => false,
        'verify_peer_name'  => false,
        'allow_self_signed' => true,
    ),
);"
    };

    let output = format!(
        "\
<?php

/* config.inc.php - generated by mission-control
 * WARNING: Do not edit manually; changes will be overwritten.
 */

// Database
$config['db_dsnw'] = '{dsn}';

// IMAP
$config['imap_host'] = '{imap_host}:{imap_port}';

{imap_conn_opts}

// SMTP
$config['smtp_host'] = '{smtp_host}:{smtp_port}';
$config['smtp_user'] = '%u';
$config['smtp_pass'] = '%p';

{smtp_conn_opts}

// System
$config['support_url'] = 'mailto:{admin_email}';
$config['product_name'] = '{product_name}';
$config['des_key'] = '{des_key}';
$config['plugins'] = array(
    'archive',
    'zipdownload',
);

// User interface
$config['language'] = '{language}';
$config['skin'] = '{skin}';
$config['draft_autosave'] = 60;
$config['mime_param_folding'] = 0;
",
        dsn = dsn,
        imap_host = php_escape(&config.imap_host),
        imap_port = config.imap_port,
        imap_conn_opts = imap_conn_opts,
        smtp_host = php_escape(&config.smtp_host),
        smtp_port = config.smtp_port,
        smtp_conn_opts = smtp_conn_opts,
        admin_email = php_escape(&config.admin_email),
        product_name = php_escape(&config.product_name),
        des_key = php_escape(&config.des_key),
        language = php_escape(&config.language),
        skin = php_escape(&config.skin),
    );

    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_php_escape_no_special() {
        assert_eq!(php_escape("hello world"), "hello world");
    }

    #[test]
    fn test_php_escape_single_quote() {
        assert_eq!(php_escape("it's"), "it\\'s");
    }

    #[test]
    fn test_php_escape_backslash() {
        assert_eq!(php_escape("path\\to\\file"), "path\\\\to\\\\file");
    }

    #[test]
    fn test_php_escape_both() {
        assert_eq!(php_escape("it's a \\path"), "it\\'s a \\\\path");
    }

    #[test]
    fn test_php_escape_empty() {
        assert_eq!(php_escape(""), "");
    }

    #[test]
    fn test_generate_des_key_length() {
        let key = generate_des_key();
        assert_eq!(key.len(), 24);
    }

    #[test]
    fn test_generate_des_key_uniqueness() {
        let key1 = generate_des_key();
        let key2 = generate_des_key();
        // Extremely unlikely to collide
        assert_ne!(key1, key2);
    }

    #[test]
    fn test_generate_default() {
        let cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        assert_eq!(cfg.product_name, "CeyMail");
        assert_eq!(cfg.admin_email, "admin@example.com");
        assert_eq!(cfg.imap_host, "ssl://mail.example.com");
        assert_eq!(cfg.imap_port, 993);
        assert_eq!(cfg.smtp_host, "tls://mail.example.com");
        assert_eq!(cfg.smtp_port, 587);
        assert!(cfg.imap_verify_tls);
        assert!(cfg.smtp_verify_tls);
        assert_eq!(cfg.des_key.len(), 24);
    }

    #[test]
    fn test_validate_good() {
        let cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        assert!(cfg.validate().is_ok());
    }

    #[test]
    fn test_validate_bad_des_key() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "tooshort".to_string();
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn test_validate_empty_db_name() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.db_name = String::new();
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn test_generate_config() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        let output = generate_config_inc_php(&cfg).unwrap();

        assert!(output.contains("<?php"));
        assert!(output.contains("$config['db_dsnw']"));
        assert!(output.contains("mysql://roundcube:changeme@localhost/roundcubemail"));
        assert!(output.contains("$config['imap_host'] = 'ssl://mail.example.com:993'"));
        assert!(output.contains("$config['smtp_host'] = 'tls://mail.example.com:587'"));
        assert!(output.contains("$config['product_name'] = 'CeyMail'"));
        assert!(output.contains("$config['des_key'] = 'abcdefghijklmnopqrstuvwx'"));
        assert!(output.contains("mailto:admin@example.com"));
    }

    #[test]
    fn test_tls_verification_enabled() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        let output = generate_config_inc_php(&cfg).unwrap();

        // imap_conn_options should have verify_peer = true
        assert!(output.contains("'verify_peer'       => true"));
        assert!(output.contains("'verify_peer_name'  => true"));
        assert!(output.contains("'allow_self_signed' => false"));
        // Must NOT contain null which was the bash script bug
        assert!(!output.contains("null"));
    }

    #[test]
    fn test_tls_verification_disabled() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        cfg.imap_verify_tls = false;
        cfg.smtp_verify_tls = false;
        let output = generate_config_inc_php(&cfg).unwrap();

        assert!(output.contains("'verify_peer'       => false"));
        assert!(output.contains("'allow_self_signed' => true"));
    }

    #[test]
    fn test_no_php_injection_via_password() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        // Attempt PHP injection through the database password
        cfg.db_password = "pass'; echo shell_exec('id'); //".to_string();
        let output = generate_config_inc_php(&cfg).unwrap();

        // The single quote should be escaped
        assert!(output.contains("pass\\'; echo shell_exec(\\'id\\'); //"));
        // Should NOT contain an unescaped single quote that would break out
        // of the PHP string
        let dsn_start = output.find("db_dsnw'] = '").unwrap();
        let after_dsn = &output[dsn_start + "db_dsnw'] = '".len()..];
        // Find the closing quote - it should be after the full escaped password
        // and the rest of the DSN
        assert!(after_dsn.contains("pass\\'"));
    }

    #[test]
    fn test_no_php_injection_via_product_name() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        cfg.product_name = "CeyMail'; phpinfo(); '".to_string();
        let output = generate_config_inc_php(&cfg).unwrap();

        assert!(output.contains("CeyMail\\'; phpinfo(); \\'"));
    }

    #[test]
    fn test_no_php_injection_via_admin_email() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        cfg.admin_email = "admin@evil.com'; system('rm -rf /'); '".to_string();
        let output = generate_config_inc_php(&cfg).unwrap();

        // Single quotes must be escaped
        assert!(!output.contains("'; system("));
        assert!(output.contains("\\'"));
    }

    #[test]
    fn test_no_sql_injection_via_db_user() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        cfg.db_user = "user' OR '1'='1".to_string();
        let output = generate_config_inc_php(&cfg).unwrap();

        // The DSN should contain the escaped username
        assert!(output.contains("user\\' OR \\'1\\'=\\'1"));
    }

    #[test]
    fn test_backslash_in_password() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        cfg.db_password = "pass\\word".to_string();
        let output = generate_config_inc_php(&cfg).unwrap();

        assert!(output.contains("pass\\\\word"));
    }

    #[test]
    fn test_admin_email_configurable() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "support@mycompany.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        let output = generate_config_inc_php(&cfg).unwrap();

        assert!(output.contains("mailto:support@mycompany.com"));
        // Verify the old hardcoded email is NOT present
        assert!(!output.contains("help@derkonline.com"));
    }

    #[test]
    fn test_smtp_user_pass_placeholders() {
        let mut cfg = RoundcubeConfig::generate_default("example.com", "admin@example.com");
        cfg.des_key = "abcdefghijklmnopqrstuvwx".to_string();
        let output = generate_config_inc_php(&cfg).unwrap();

        // Roundcube uses %u and %p placeholders for the logged-in user's credentials
        assert!(output.contains("$config['smtp_user'] = '%u'"));
        assert!(output.contains("$config['smtp_pass'] = '%p'"));
    }
}
