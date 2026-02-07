use super::parser::{parse_config, ConfigFile, ConfigLine};
use std::fmt;

/// Postfix main.cf configuration manager.
///
/// Wraps the generic key=value parser and provides typed access
/// to common Postfix directives. Also generates the MySQL lookup
/// table configuration files used for virtual mailbox hosting.
#[derive(Debug, Clone)]
pub struct PostfixConfig {
    inner: ConfigFile,
}

/// Errors specific to Postfix configuration.
#[derive(Debug)]
pub enum PostfixConfigError {
    ParseError(String),
    ValidationError(Vec<String>),
}

impl fmt::Display for PostfixConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ParseError(msg) => write!(f, "Postfix config parse error: {}", msg),
            Self::ValidationError(msgs) => {
                write!(f, "Postfix config validation errors: ")?;
                for (i, msg) in msgs.iter().enumerate() {
                    if i > 0 {
                        write!(f, "; ")?;
                    }
                    write!(f, "{}", msg)?;
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for PostfixConfigError {}

impl PostfixConfig {
    /// Parse an existing main.cf file.
    pub fn parse(input: &str) -> Result<Self, PostfixConfigError> {
        let inner = parse_config(input).map_err(PostfixConfigError::ParseError)?;
        Ok(Self { inner })
    }

    /// Serialize back to main.cf format.
    pub fn to_string(&self) -> String {
        self.inner.serialize()
    }

    // ── typed getters ──────────────────────────────────────────────

    pub fn myhostname(&self) -> Option<&str> {
        self.inner.get("myhostname")
    }

    pub fn mydomain(&self) -> Option<&str> {
        self.inner.get("mydomain")
    }

    pub fn myorigin(&self) -> Option<&str> {
        self.inner.get("myorigin")
    }

    pub fn mydestination(&self) -> Option<&str> {
        self.inner.get("mydestination")
    }

    pub fn inet_interfaces(&self) -> Option<&str> {
        self.inner.get("inet_interfaces")
    }

    pub fn inet_protocols(&self) -> Option<&str> {
        self.inner.get("inet_protocols")
    }

    pub fn virtual_mailbox_domains(&self) -> Option<&str> {
        self.inner.get("virtual_mailbox_domains")
    }

    pub fn virtual_mailbox_maps(&self) -> Option<&str> {
        self.inner.get("virtual_mailbox_maps")
    }

    pub fn virtual_alias_maps(&self) -> Option<&str> {
        self.inner.get("virtual_alias_maps")
    }

    pub fn smtpd_tls_cert_file(&self) -> Option<&str> {
        self.inner.get("smtpd_tls_cert_file")
    }

    pub fn smtpd_tls_key_file(&self) -> Option<&str> {
        self.inner.get("smtpd_tls_key_file")
    }

    pub fn smtpd_recipient_restrictions(&self) -> Option<&str> {
        self.inner.get("smtpd_recipient_restrictions")
    }

    pub fn milter_protocol(&self) -> Option<&str> {
        self.inner.get("milter_protocol")
    }

    pub fn smtpd_milters(&self) -> Option<&str> {
        self.inner.get("smtpd_milters")
    }

    pub fn non_smtpd_milters(&self) -> Option<&str> {
        self.inner.get("non_smtpd_milters")
    }

    pub fn virtual_mailbox_base(&self) -> Option<&str> {
        self.inner.get("virtual_mailbox_base")
    }

    pub fn virtual_minimum_uid(&self) -> Option<&str> {
        self.inner.get("virtual_minimum_uid")
    }

    pub fn virtual_uid_maps(&self) -> Option<&str> {
        self.inner.get("virtual_uid_maps")
    }

    pub fn virtual_gid_maps(&self) -> Option<&str> {
        self.inner.get("virtual_gid_maps")
    }

    pub fn virtual_transport(&self) -> Option<&str> {
        self.inner.get("virtual_transport")
    }

    // ── typed setters ──────────────────────────────────────────────

    pub fn set_myhostname(&mut self, val: &str) {
        self.inner.set("myhostname", val);
    }

    pub fn set_mydomain(&mut self, val: &str) {
        self.inner.set("mydomain", val);
    }

    pub fn set_myorigin(&mut self, val: &str) {
        self.inner.set("myorigin", val);
    }

    pub fn set_mydestination(&mut self, val: &str) {
        self.inner.set("mydestination", val);
    }

    pub fn set_inet_interfaces(&mut self, val: &str) {
        self.inner.set("inet_interfaces", val);
    }

    pub fn set_inet_protocols(&mut self, val: &str) {
        self.inner.set("inet_protocols", val);
    }

    pub fn set_virtual_mailbox_domains(&mut self, val: &str) {
        self.inner.set("virtual_mailbox_domains", val);
    }

    pub fn set_virtual_mailbox_maps(&mut self, val: &str) {
        self.inner.set("virtual_mailbox_maps", val);
    }

    pub fn set_virtual_alias_maps(&mut self, val: &str) {
        self.inner.set("virtual_alias_maps", val);
    }

    pub fn set_smtpd_tls_cert_file(&mut self, val: &str) {
        self.inner.set("smtpd_tls_cert_file", val);
    }

    pub fn set_smtpd_tls_key_file(&mut self, val: &str) {
        self.inner.set("smtpd_tls_key_file", val);
    }

    pub fn set_smtpd_recipient_restrictions(&mut self, val: &str) {
        self.inner.set("smtpd_recipient_restrictions", val);
    }

    pub fn set_milter_protocol(&mut self, val: &str) {
        self.inner.set("milter_protocol", val);
    }

    pub fn set_smtpd_milters(&mut self, val: &str) {
        self.inner.set("smtpd_milters", val);
    }

    pub fn set_non_smtpd_milters(&mut self, val: &str) {
        self.inner.set("non_smtpd_milters", val);
    }

    /// Set an arbitrary key.
    pub fn set(&mut self, key: &str, val: &str) {
        self.inner.set(key, val);
    }

    /// Get an arbitrary key.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.inner.get(key)
    }

    // ── generation ─────────────────────────────────────────────────

    /// Generate a secure default main.cf matching what the bash install
    /// script would have configured, but with stronger defaults.
    pub fn generate_default(hostname: &str, domain: &str) -> Self {
        let mut cfg = ConfigFile {
            entries: Vec::new(),
        };

        let push_comment = |cfg: &mut ConfigFile, text: &str| {
            cfg.entries.push(ConfigLine::Comment(text.to_string()));
        };
        let push_blank = |cfg: &mut ConfigFile| {
            cfg.entries.push(ConfigLine::Blank);
        };
        let push_kv = |cfg: &mut ConfigFile, k: &str, v: &str| {
            cfg.entries.push(ConfigLine::KeyValue {
                key: k.to_string(),
                value: v.to_string(),
            });
        };

        push_comment(&mut cfg, "# Postfix main.cf - generated by mission-control");
        push_comment(
            &mut cfg,
            "# See /usr/share/postfix/main.cf.dist for a full reference",
        );
        push_blank(&mut cfg);

        // Basic identity
        push_comment(&mut cfg, "# Basic host identity");
        push_kv(&mut cfg, "myhostname", hostname);
        push_kv(&mut cfg, "mydomain", domain);
        push_kv(&mut cfg, "myorigin", &format!("$mydomain"));
        push_kv(
            &mut cfg,
            "mydestination",
            "$myhostname, localhost.$mydomain, localhost",
        );
        push_blank(&mut cfg);

        // Network
        push_comment(&mut cfg, "# Network settings");
        push_kv(&mut cfg, "inet_interfaces", "all");
        push_kv(&mut cfg, "inet_protocols", "all");
        push_blank(&mut cfg);

        // TLS
        push_comment(&mut cfg, "# TLS settings");
        push_kv(
            &mut cfg,
            "smtpd_tls_cert_file",
            &format!("/etc/letsencrypt/live/{}/fullchain.pem", hostname),
        );
        push_kv(
            &mut cfg,
            "smtpd_tls_key_file",
            &format!("/etc/letsencrypt/live/{}/privkey.pem", hostname),
        );
        push_kv(&mut cfg, "smtpd_use_tls", "yes");
        push_kv(&mut cfg, "smtpd_tls_auth_only", "yes");
        push_kv(&mut cfg, "smtpd_tls_security_level", "may");
        push_kv(&mut cfg, "smtp_tls_security_level", "may");
        push_kv(&mut cfg, "smtpd_tls_protocols", "!SSLv2, !SSLv3, !TLSv1, !TLSv1.1");
        push_kv(&mut cfg, "smtp_tls_protocols", "!SSLv2, !SSLv3, !TLSv1, !TLSv1.1");
        push_kv(
            &mut cfg,
            "smtpd_tls_mandatory_ciphers",
            "medium",
        );
        push_blank(&mut cfg);

        // SASL
        push_comment(&mut cfg, "# SASL authentication");
        push_kv(&mut cfg, "smtpd_sasl_type", "dovecot");
        push_kv(&mut cfg, "smtpd_sasl_path", "private/auth");
        push_kv(&mut cfg, "smtpd_sasl_auth_enable", "yes");
        push_blank(&mut cfg);

        // Recipient restrictions with DNSBL
        push_comment(&mut cfg, "# Recipient restrictions (including DNSBL)");
        let restrictions = [
            "permit_sasl_authenticated",
            "permit_mynetworks",
            "reject_unauth_destination",
            "reject_rbl_client zen.spamhaus.org",
            "reject_rbl_client bl.spamcop.net",
            "reject_rbl_client b.barracudacentral.org",
        ]
        .join(", ");
        push_kv(&mut cfg, "smtpd_recipient_restrictions", &restrictions);
        push_blank(&mut cfg);

        // Virtual mailbox settings
        push_comment(&mut cfg, "# Virtual mailbox hosting via MySQL");
        push_kv(
            &mut cfg,
            "virtual_mailbox_domains",
            "mysql:/etc/postfix/mysql-virtual-mailbox-domains.cf",
        );
        push_kv(
            &mut cfg,
            "virtual_mailbox_maps",
            "mysql:/etc/postfix/mysql-virtual-mailbox-maps.cf",
        );
        push_kv(
            &mut cfg,
            "virtual_alias_maps",
            "mysql:/etc/postfix/mysql-virtual-alias-maps.cf",
        );
        push_kv(&mut cfg, "virtual_mailbox_base", "/var/mail/vhosts");
        push_kv(&mut cfg, "virtual_minimum_uid", "5000");
        push_kv(&mut cfg, "virtual_uid_maps", "static:5000");
        push_kv(&mut cfg, "virtual_gid_maps", "static:5000");
        push_kv(&mut cfg, "virtual_transport", "lmtp:unix:private/dovecot-lmtp");
        push_blank(&mut cfg);

        // OpenDKIM milter
        push_comment(&mut cfg, "# OpenDKIM milter integration");
        push_kv(&mut cfg, "milter_protocol", "6");
        push_kv(&mut cfg, "milter_default_action", "accept");
        push_kv(
            &mut cfg,
            "smtpd_milters",
            "inet:localhost:8891",
        );
        push_kv(
            &mut cfg,
            "non_smtpd_milters",
            "inet:localhost:8891",
        );
        push_blank(&mut cfg);

        // Misc hardening
        push_comment(&mut cfg, "# Miscellaneous hardening");
        push_kv(&mut cfg, "smtpd_helo_required", "yes");
        push_kv(&mut cfg, "disable_vrfy_command", "yes");
        push_kv(&mut cfg, "message_size_limit", "52428800");
        push_kv(&mut cfg, "smtpd_banner", "$myhostname ESMTP");

        Self { inner: cfg }
    }

    // ── validation ─────────────────────────────────────────────────

    /// Validate the config and return a list of warnings/errors.
    /// An empty vec means the config looks good.
    pub fn validate(&self) -> Result<Vec<String>, PostfixConfigError> {
        let mut warnings: Vec<String> = Vec::new();

        if self.myhostname().is_none() {
            warnings.push("myhostname is not set".to_string());
        }
        if self.mydomain().is_none() {
            warnings.push("mydomain is not set".to_string());
        }

        // Check TLS
        if let Some(cert) = self.smtpd_tls_cert_file() {
            if cert.is_empty() {
                warnings.push("smtpd_tls_cert_file is empty".to_string());
            }
        } else {
            warnings.push("smtpd_tls_cert_file is not configured".to_string());
        }

        if let Some(key) = self.smtpd_tls_key_file() {
            if key.is_empty() {
                warnings.push("smtpd_tls_key_file is empty".to_string());
            }
        } else {
            warnings.push("smtpd_tls_key_file is not configured".to_string());
        }

        // Check inet_interfaces
        if let Some(ifaces) = self.inet_interfaces() {
            if ifaces == "localhost" {
                warnings.push(
                    "inet_interfaces is set to localhost only - external mail will not work"
                        .to_string(),
                );
            }
        }

        // Check for DNSBL in recipient restrictions
        if let Some(restrictions) = self.smtpd_recipient_restrictions() {
            if !restrictions.contains("reject_rbl_client") {
                warnings
                    .push("No DNSBL (reject_rbl_client) in smtpd_recipient_restrictions".to_string());
            }
        } else {
            warnings.push("smtpd_recipient_restrictions is not configured".to_string());
        }

        // Check virtual mailbox
        if self.virtual_mailbox_domains().is_none() {
            warnings.push("virtual_mailbox_domains is not configured".to_string());
        }
        if self.virtual_mailbox_maps().is_none() {
            warnings.push("virtual_mailbox_maps is not configured".to_string());
        }

        // Check milter for DKIM
        if self.smtpd_milters().is_none() {
            warnings.push("smtpd_milters not configured - DKIM signing may not work".to_string());
        }

        Ok(warnings)
    }

    // ── MySQL virtual-mailbox config generators ────────────────────

    /// Generate /etc/postfix/mysql-virtual-mailbox-domains.cf content.
    /// Uses parameterized queries, not string interpolation.
    pub fn generate_mysql_virtual_domains(
        db_user: &str,
        db_password: &str,
        db_name: &str,
    ) -> String {
        format!(
            "\
user = {}
password = {}
hosts = 127.0.0.1
dbname = {}
query = SELECT 1 FROM virtual_domains WHERE name='%s'
",
            db_user, db_password, db_name
        )
    }

    /// Generate /etc/postfix/mysql-virtual-mailbox-maps.cf content.
    /// Uses parameterized queries, not string interpolation.
    pub fn generate_mysql_virtual_users(
        db_user: &str,
        db_password: &str,
        db_name: &str,
    ) -> String {
        format!(
            "\
user = {}
password = {}
hosts = 127.0.0.1
dbname = {}
query = SELECT CONCAT(virtual_domains.name, '/', virtual_users.email, '/') FROM virtual_users INNER JOIN virtual_domains ON virtual_users.domain_id = virtual_domains.id WHERE virtual_users.email='%s'
",
            db_user, db_password, db_name
        )
    }

    /// Generate /etc/postfix/mysql-virtual-alias-maps.cf content.
    /// Uses parameterized queries, not string interpolation.
    pub fn generate_mysql_virtual_aliases(
        db_user: &str,
        db_password: &str,
        db_name: &str,
    ) -> String {
        format!(
            "\
user = {}
password = {}
hosts = 127.0.0.1
dbname = {}
query = SELECT destination FROM virtual_aliases INNER JOIN virtual_domains ON virtual_aliases.domain_id = virtual_domains.id WHERE source='%s'
",
            db_user, db_password, db_name
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_default() {
        let cfg = PostfixConfig::generate_default("mail.example.com", "example.com");
        assert_eq!(cfg.myhostname(), Some("mail.example.com"));
        assert_eq!(cfg.mydomain(), Some("example.com"));
        assert_eq!(cfg.myorigin(), Some("$mydomain"));
        assert_eq!(cfg.inet_interfaces(), Some("all"));
        assert_eq!(cfg.inet_protocols(), Some("all"));
        assert!(cfg
            .smtpd_tls_cert_file()
            .unwrap()
            .contains("mail.example.com"));
        assert!(cfg
            .smtpd_tls_key_file()
            .unwrap()
            .contains("mail.example.com"));
        assert_eq!(cfg.milter_protocol(), Some("6"));
        assert!(cfg.smtpd_milters().unwrap().contains("8891"));
        assert!(cfg.non_smtpd_milters().unwrap().contains("8891"));
    }

    #[test]
    fn test_generate_default_has_dnsbl() {
        let cfg = PostfixConfig::generate_default("mail.example.com", "example.com");
        let restrictions = cfg.smtpd_recipient_restrictions().unwrap();
        assert!(restrictions.contains("zen.spamhaus.org"));
        assert!(restrictions.contains("bl.spamcop.net"));
        assert!(restrictions.contains("b.barracudacentral.org"));
    }

    #[test]
    fn test_generate_default_virtual_mailbox() {
        let cfg = PostfixConfig::generate_default("mail.example.com", "example.com");
        assert!(cfg
            .virtual_mailbox_domains()
            .unwrap()
            .contains("mysql:"));
        assert!(cfg.virtual_mailbox_maps().unwrap().contains("mysql:"));
        assert!(cfg.virtual_alias_maps().unwrap().contains("mysql:"));
        assert_eq!(cfg.virtual_mailbox_base(), Some("/var/mail/vhosts"));
        assert_eq!(cfg.virtual_minimum_uid(), Some("5000"));
        assert_eq!(cfg.virtual_uid_maps(), Some("static:5000"));
        assert_eq!(cfg.virtual_gid_maps(), Some("static:5000"));
        assert_eq!(
            cfg.virtual_transport(),
            Some("lmtp:unix:private/dovecot-lmtp")
        );
    }

    #[test]
    fn test_roundtrip() {
        let cfg = PostfixConfig::generate_default("mail.example.com", "example.com");
        let text = cfg.to_string();
        let cfg2 = PostfixConfig::parse(&text).unwrap();
        assert_eq!(cfg2.myhostname(), Some("mail.example.com"));
        assert_eq!(cfg2.mydomain(), Some("example.com"));
        assert_eq!(cfg2.milter_protocol(), Some("6"));
    }

    #[test]
    fn test_parse_existing_config() {
        let input = "\
myhostname = mail.test.org
mydomain = test.org
inet_interfaces = all
smtpd_tls_cert_file = /etc/ssl/certs/test.pem
smtpd_tls_key_file = /etc/ssl/private/test.key
";
        let cfg = PostfixConfig::parse(input).unwrap();
        assert_eq!(cfg.myhostname(), Some("mail.test.org"));
        assert_eq!(cfg.smtpd_tls_cert_file(), Some("/etc/ssl/certs/test.pem"));
    }

    #[test]
    fn test_set_and_get() {
        let mut cfg = PostfixConfig::generate_default("mail.example.com", "example.com");
        cfg.set_myhostname("mail.newdomain.com");
        assert_eq!(cfg.myhostname(), Some("mail.newdomain.com"));
        cfg.set_mydomain("newdomain.com");
        assert_eq!(cfg.mydomain(), Some("newdomain.com"));
    }

    #[test]
    fn test_validate_good_config() {
        let cfg = PostfixConfig::generate_default("mail.example.com", "example.com");
        let warnings = cfg.validate().unwrap();
        assert!(warnings.is_empty(), "Unexpected warnings: {:?}", warnings);
    }

    #[test]
    fn test_validate_missing_hostname() {
        let cfg = PostfixConfig::parse("mydomain = example.com\n").unwrap();
        let warnings = cfg.validate().unwrap();
        assert!(warnings.iter().any(|w| w.contains("myhostname")));
    }

    #[test]
    fn test_validate_no_dnsbl() {
        let input = "\
myhostname = mail.example.com
mydomain = example.com
smtpd_tls_cert_file = /etc/ssl/cert.pem
smtpd_tls_key_file = /etc/ssl/key.pem
smtpd_recipient_restrictions = permit_mynetworks, reject_unauth_destination
";
        let cfg = PostfixConfig::parse(input).unwrap();
        let warnings = cfg.validate().unwrap();
        assert!(warnings.iter().any(|w| w.contains("DNSBL")));
    }

    #[test]
    fn test_validate_localhost_only() {
        let input = "\
myhostname = mail.example.com
mydomain = example.com
inet_interfaces = localhost
smtpd_tls_cert_file = /etc/ssl/cert.pem
smtpd_tls_key_file = /etc/ssl/key.pem
smtpd_recipient_restrictions = reject_rbl_client zen.spamhaus.org
virtual_mailbox_domains = mysql:/etc/postfix/mysql-virtual-mailbox-domains.cf
virtual_mailbox_maps = mysql:/etc/postfix/mysql-virtual-mailbox-maps.cf
smtpd_milters = inet:localhost:8891
";
        let cfg = PostfixConfig::parse(input).unwrap();
        let warnings = cfg.validate().unwrap();
        assert!(warnings.iter().any(|w| w.contains("localhost only")));
    }

    #[test]
    fn test_mysql_virtual_domains() {
        let output =
            PostfixConfig::generate_mysql_virtual_domains("mailuser", "secret", "mailserver");
        assert!(output.contains("user = mailuser"));
        assert!(output.contains("password = secret"));
        assert!(output.contains("dbname = mailserver"));
        assert!(output.contains("virtual_domains"));
        assert!(output.contains("'%s'"));
    }

    #[test]
    fn test_mysql_virtual_users() {
        let output =
            PostfixConfig::generate_mysql_virtual_users("mailuser", "secret", "mailserver");
        assert!(output.contains("user = mailuser"));
        assert!(output.contains("virtual_users"));
        assert!(output.contains("virtual_domains"));
        assert!(output.contains("'%s'"));
    }

    #[test]
    fn test_mysql_virtual_aliases() {
        let output =
            PostfixConfig::generate_mysql_virtual_aliases("mailuser", "secret", "mailserver");
        assert!(output.contains("user = mailuser"));
        assert!(output.contains("virtual_aliases"));
        assert!(output.contains("virtual_domains"));
        assert!(output.contains("'%s'"));
    }

    #[test]
    fn test_tls_hardening() {
        let cfg = PostfixConfig::generate_default("mail.example.com", "example.com");
        assert_eq!(cfg.get("smtpd_use_tls"), Some("yes"));
        assert_eq!(cfg.get("smtpd_tls_auth_only"), Some("yes"));
        let protocols = cfg.get("smtpd_tls_protocols").unwrap();
        assert!(protocols.contains("!SSLv2"));
        assert!(protocols.contains("!SSLv3"));
        assert!(protocols.contains("!TLSv1.1"));
    }

    #[test]
    fn test_misc_hardening() {
        let cfg = PostfixConfig::generate_default("mail.example.com", "example.com");
        assert_eq!(cfg.get("smtpd_helo_required"), Some("yes"));
        assert_eq!(cfg.get("disable_vrfy_command"), Some("yes"));
    }
}
