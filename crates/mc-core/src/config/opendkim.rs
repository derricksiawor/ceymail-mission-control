use once_cell::sync::Lazy;
use regex::Regex;
use std::fmt;

/// A single domain entry in the DKIM configuration tables.
#[derive(Debug, Clone, PartialEq)]
pub struct DkimDomainEntry {
    pub domain: String,
    pub selector: String,
}

/// OpenDKIM configuration manager.
///
/// Manages the main opendkim.conf plus the three lookup tables:
///   - KeyTable
///   - SigningTable
///   - TrustedHosts
#[derive(Debug, Clone)]
pub struct OpendkimConfig {
    /// Entries in the key table (one per domain).
    pub key_table: Vec<DkimDomainEntry>,
    /// Entries in the signing table (one per domain).
    pub signing_table: Vec<DkimDomainEntry>,
    /// List of trusted hosts/domains.
    pub trusted_hosts: Vec<String>,
    /// Socket specification (e.g. "inet:8891@localhost").
    pub socket: String,
    /// Mode: "sv" = sign and verify (default).
    pub mode: String,
    /// Canonicalization setting.
    pub canonicalization: String,
    /// Base directory for DKIM keys.
    pub key_base_dir: String,
}

#[derive(Debug)]
pub enum OpendkimConfigError {
    InvalidDomain(String),
    DomainAlreadyExists(String),
    DomainNotFound(String),
}

impl fmt::Display for OpendkimConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDomain(d) => write!(f, "Invalid domain name: {}", d),
            Self::DomainAlreadyExists(d) => write!(f, "Domain already exists: {}", d),
            Self::DomainNotFound(d) => write!(f, "Domain not found: {}", d),
        }
    }
}

impl std::error::Error for OpendkimConfigError {}

static DOMAIN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$").unwrap()
});

static SELECTOR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$").unwrap()
});

/// Validate that a domain name is safe for use in config files.
/// Only allows alphanumeric, hyphens, and dots. Must not start or
/// end with a hyphen or dot, and must contain at least one dot.
fn validate_domain(domain: &str) -> Result<(), OpendkimConfigError> {
    if domain.is_empty() {
        return Err(OpendkimConfigError::InvalidDomain(
            "domain is empty".to_string(),
        ));
    }

    if !DOMAIN_RE.is_match(domain) {
        return Err(OpendkimConfigError::InvalidDomain(domain.to_string()));
    }

    Ok(())
}

/// Validate that a selector is safe for use in config files.
/// Only allows alphanumeric and hyphens.
fn validate_selector(selector: &str) -> Result<(), OpendkimConfigError> {
    if selector.is_empty() {
        return Err(OpendkimConfigError::InvalidDomain(
            "selector is empty".to_string(),
        ));
    }

    if !SELECTOR_RE.is_match(selector) {
        return Err(OpendkimConfigError::InvalidDomain(format!(
            "invalid selector: {}",
            selector
        )));
    }

    Ok(())
}

impl OpendkimConfig {
    /// Create a config with secure defaults.
    pub fn generate_default() -> Self {
        Self {
            key_table: Vec::new(),
            signing_table: Vec::new(),
            trusted_hosts: vec![
                "127.0.0.1".to_string(),
                "localhost".to_string(),
            ],
            socket: "inet:8891@localhost".to_string(),
            mode: "sv".to_string(),
            canonicalization: "relaxed/simple".to_string(),
            key_base_dir: "/etc/opendkim/keys".to_string(),
        }
    }

    /// Add a domain to all three tables.
    pub fn add_domain(
        &mut self,
        domain: &str,
        selector: &str,
    ) -> Result<(), OpendkimConfigError> {
        validate_domain(domain)?;
        validate_selector(selector)?;

        // Check for duplicates
        if self.key_table.iter().any(|e| e.domain == domain) {
            return Err(OpendkimConfigError::DomainAlreadyExists(
                domain.to_string(),
            ));
        }

        let entry = DkimDomainEntry {
            domain: domain.to_string(),
            selector: selector.to_string(),
        };

        self.key_table.push(entry.clone());
        self.signing_table.push(entry);

        // Add the domain to trusted hosts if not already present
        if !self.trusted_hosts.iter().any(|h| h == domain) {
            self.trusted_hosts.push(domain.to_string());
        }

        // Also add the wildcard
        let wildcard = format!("*.{}", domain);
        if !self.trusted_hosts.iter().any(|h| h == &wildcard) {
            self.trusted_hosts.push(wildcard);
        }

        Ok(())
    }

    /// Remove a domain from all three tables.
    pub fn remove_domain(&mut self, domain: &str) -> Result<(), OpendkimConfigError> {
        validate_domain(domain)?;

        let before = self.key_table.len();
        self.key_table.retain(|e| e.domain != domain);
        if self.key_table.len() == before {
            return Err(OpendkimConfigError::DomainNotFound(domain.to_string()));
        }

        self.signing_table.retain(|e| e.domain != domain);

        let wildcard = format!("*.{}", domain);
        self.trusted_hosts
            .retain(|h| h != domain && h != &wildcard);

        Ok(())
    }

    /// List all configured domains.
    pub fn list_domains(&self) -> Vec<DkimDomainEntry> {
        self.key_table.clone()
    }

    // ── config file generators ─────────────────────────────────────

    /// Load the OpenDKIM configuration from the standard paths.
    pub fn load() -> Result<Self, OpendkimConfigError> {
        let mut config = Self::generate_default();

        // Parse key.table if it exists
        let key_table_path = "/etc/opendkim/key.table";
        if let Ok(content) = std::fs::read_to_string(key_table_path) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                // Format: selector._domainkey.domain domain:selector:keypath
                if let Some((_left, right)) = line.split_once(' ') {
                    let parts: Vec<&str> = right.splitn(3, ':').collect();
                    if parts.len() >= 2 {
                        let domain = parts[0].to_string();
                        let selector = parts[1].to_string();
                        // Avoid duplicates
                        if !config.key_table.iter().any(|e| e.domain == domain) {
                            config.key_table.push(DkimDomainEntry {
                                domain: domain.clone(),
                                selector: selector.clone(),
                            });
                            config.signing_table.push(DkimDomainEntry {
                                domain,
                                selector,
                            });
                        }
                    }
                }
            }
        }

        // Parse trusted.hosts if it exists
        let trusted_path = "/etc/opendkim/trusted.hosts";
        if let Ok(content) = std::fs::read_to_string(trusted_path) {
            config.trusted_hosts.clear();
            for line in content.lines() {
                let line = line.trim();
                if !line.is_empty() && !line.starts_with('#') {
                    config.trusted_hosts.push(line.to_string());
                }
            }
        }

        Ok(config)
    }

    /// Save the OpenDKIM configuration to the standard paths.
    pub fn save(&self) -> Result<(), OpendkimConfigError> {
        let base = std::path::Path::new("/etc/opendkim");
        std::fs::create_dir_all(base).map_err(|e| {
            OpendkimConfigError::InvalidDomain(format!("Failed to create /etc/opendkim: {}", e))
        })?;

        // Write main config
        std::fs::write("/etc/opendkim.conf", self.generate_opendkim_conf()).map_err(|e| {
            OpendkimConfigError::InvalidDomain(format!("Failed to write opendkim.conf: {}", e))
        })?;

        // Write key table
        std::fs::write(base.join("key.table"), self.generate_key_table()).map_err(|e| {
            OpendkimConfigError::InvalidDomain(format!("Failed to write key.table: {}", e))
        })?;

        // Write signing table
        std::fs::write(base.join("signing.table"), self.generate_signing_table()).map_err(|e| {
            OpendkimConfigError::InvalidDomain(format!("Failed to write signing.table: {}", e))
        })?;

        // Write trusted hosts
        std::fs::write(base.join("trusted.hosts"), self.generate_trusted_hosts()).map_err(|e| {
            OpendkimConfigError::InvalidDomain(format!("Failed to write trusted.hosts: {}", e))
        })?;

        Ok(())
    }

    /// Generate the main opendkim.conf content.
    pub fn generate_opendkim_conf(&self) -> String {
        format!(
            "\
## generated by mission-control
AutoRestart             Yes
AutoRestartRate         10/1h
Syslog                  yes
SyslogSuccess           Yes
LogWhy                  Yes

Canonicalization        {canonicalization}
Mode                    {mode}
SubDomains              no

OversignHeaders         From

Socket                  {socket}
PidFile                 /run/opendkim/opendkim.pid
UMask                   002

UserID                  opendkim:opendkim

TrustAnchorFile         /usr/share/dns/root.key

KeyTable                refile:/etc/opendkim/key.table
SigningTable            refile:/etc/opendkim/signing.table
ExternalIgnoreList      /etc/opendkim/trusted.hosts
InternalHosts           /etc/opendkim/trusted.hosts
",
            canonicalization = self.canonicalization,
            mode = self.mode,
            socket = self.socket,
        )
    }

    /// Generate key.table content.
    ///
    /// Format: <selector>._domainkey.<domain> <domain>:<selector>:<keypath>
    pub fn generate_key_table(&self) -> String {
        let mut out = String::new();
        for entry in &self.key_table {
            out.push_str(&format!(
                "{}._domainkey.{} {}:{}:{}/{}/{}.private\n",
                entry.selector,
                entry.domain,
                entry.domain,
                entry.selector,
                self.key_base_dir,
                entry.domain,
                entry.selector,
            ));
        }
        out
    }

    /// Generate signing.table content.
    ///
    /// Format: *@<domain> <selector>._domainkey.<domain>
    pub fn generate_signing_table(&self) -> String {
        let mut out = String::new();
        for entry in &self.signing_table {
            out.push_str(&format!(
                "*@{} {}._domainkey.{}\n",
                entry.domain, entry.selector, entry.domain,
            ));
        }
        out
    }

    /// Generate trusted.hosts content.
    pub fn generate_trusted_hosts(&self) -> String {
        let mut out = String::new();
        for host in &self.trusted_hosts {
            out.push_str(host);
            out.push('\n');
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_default() {
        let cfg = OpendkimConfig::generate_default();
        assert_eq!(cfg.socket, "inet:8891@localhost");
        assert_eq!(cfg.mode, "sv");
        assert!(cfg.trusted_hosts.contains(&"127.0.0.1".to_string()));
        assert!(cfg.trusted_hosts.contains(&"localhost".to_string()));
    }

    #[test]
    fn test_add_domain() {
        let mut cfg = OpendkimConfig::generate_default();
        cfg.add_domain("example.com", "mail").unwrap();

        assert_eq!(cfg.key_table.len(), 1);
        assert_eq!(cfg.key_table[0].domain, "example.com");
        assert_eq!(cfg.key_table[0].selector, "mail");
        assert!(cfg.trusted_hosts.contains(&"example.com".to_string()));
        assert!(cfg.trusted_hosts.contains(&"*.example.com".to_string()));
    }

    #[test]
    fn test_add_multiple_domains() {
        let mut cfg = OpendkimConfig::generate_default();
        cfg.add_domain("example.com", "mail").unwrap();
        cfg.add_domain("other.org", "dkim2024").unwrap();

        assert_eq!(cfg.key_table.len(), 2);
        assert_eq!(cfg.signing_table.len(), 2);
    }

    #[test]
    fn test_add_duplicate_domain() {
        let mut cfg = OpendkimConfig::generate_default();
        cfg.add_domain("example.com", "mail").unwrap();
        let result = cfg.add_domain("example.com", "other");
        assert!(result.is_err());
    }

    #[test]
    fn test_remove_domain() {
        let mut cfg = OpendkimConfig::generate_default();
        cfg.add_domain("example.com", "mail").unwrap();
        cfg.add_domain("other.org", "dkim2024").unwrap();

        cfg.remove_domain("example.com").unwrap();
        assert_eq!(cfg.key_table.len(), 1);
        assert_eq!(cfg.key_table[0].domain, "other.org");
        assert!(!cfg.trusted_hosts.contains(&"example.com".to_string()));
        assert!(!cfg.trusted_hosts.contains(&"*.example.com".to_string()));
    }

    #[test]
    fn test_remove_nonexistent_domain() {
        let mut cfg = OpendkimConfig::generate_default();
        let result = cfg.remove_domain("example.com");
        assert!(result.is_err());
    }

    #[test]
    fn test_list_domains() {
        let mut cfg = OpendkimConfig::generate_default();
        cfg.add_domain("example.com", "mail").unwrap();
        cfg.add_domain("other.org", "dkim").unwrap();

        let domains = cfg.list_domains();
        assert_eq!(domains.len(), 2);
        assert_eq!(domains[0].domain, "example.com");
        assert_eq!(domains[1].domain, "other.org");
    }

    #[test]
    fn test_generate_opendkim_conf() {
        let cfg = OpendkimConfig::generate_default();
        let out = cfg.generate_opendkim_conf();
        assert!(out.contains("Socket                  inet:8891@localhost"));
        assert!(out.contains("Mode                    sv"));
        assert!(out.contains("Canonicalization        relaxed/simple"));
        assert!(out.contains("KeyTable"));
        assert!(out.contains("SigningTable"));
        assert!(out.contains("TrustedHosts") || out.contains("trusted.hosts"));
        assert!(out.contains("OversignHeaders         From"));
    }

    #[test]
    fn test_generate_key_table() {
        let mut cfg = OpendkimConfig::generate_default();
        cfg.add_domain("example.com", "mail").unwrap();
        let out = cfg.generate_key_table();
        assert_eq!(
            out,
            "mail._domainkey.example.com example.com:mail:/etc/opendkim/keys/example.com/mail.private\n"
        );
    }

    #[test]
    fn test_generate_signing_table() {
        let mut cfg = OpendkimConfig::generate_default();
        cfg.add_domain("example.com", "mail").unwrap();
        let out = cfg.generate_signing_table();
        assert_eq!(out, "*@example.com mail._domainkey.example.com\n");
    }

    #[test]
    fn test_generate_trusted_hosts() {
        let mut cfg = OpendkimConfig::generate_default();
        cfg.add_domain("example.com", "mail").unwrap();
        let out = cfg.generate_trusted_hosts();
        assert!(out.contains("127.0.0.1"));
        assert!(out.contains("localhost"));
        assert!(out.contains("example.com"));
        assert!(out.contains("*.example.com"));
    }

    // ── domain validation tests ────────────────────────────────────

    #[test]
    fn test_invalid_domain_empty() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain("", "mail").is_err());
    }

    #[test]
    fn test_invalid_domain_no_dot() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain("localhost", "mail").is_err());
    }

    #[test]
    fn test_invalid_domain_shell_injection() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain("example.com; rm -rf /", "mail").is_err());
    }

    #[test]
    fn test_invalid_domain_newline() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain("example.com\nevil.com", "mail").is_err());
    }

    #[test]
    fn test_invalid_domain_leading_dot() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain(".example.com", "mail").is_err());
    }

    #[test]
    fn test_invalid_domain_trailing_dot() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain("example.com.", "mail").is_err());
    }

    #[test]
    fn test_invalid_selector_spaces() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain("example.com", "mail key").is_err());
    }

    #[test]
    fn test_invalid_selector_shell_injection() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain("example.com", "$(whoami)").is_err());
    }

    #[test]
    fn test_valid_subdomain() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain("sub.example.com", "mail").is_ok());
    }

    #[test]
    fn test_valid_selector_with_numbers() {
        let mut cfg = OpendkimConfig::generate_default();
        assert!(cfg.add_domain("example.com", "dkim2024").is_ok());
    }
}
