//! Strict allowlist-based input validation to prevent shell injection, SQL injection,
//! directory traversal, and other injection attacks.
//!
//! Every external input that flows into subprocess arguments, file paths, database
//! queries, or configuration files MUST pass through one of these validators first.
//! This replaces the CeyMail bash scripts' complete lack of input sanitization.

use once_cell::sync::Lazy;
use regex::Regex;
use thiserror::Error;

/// Errors returned when input fails validation.
#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("Invalid domain name: {0}")]
    InvalidDomain(String),
    #[error("Invalid email address: {0}")]
    InvalidEmail(String),
    #[error("Invalid database name: {0}")]
    InvalidDatabaseName(String),
    #[error("Invalid username: {0}")]
    InvalidUsername(String),
    #[error("Invalid hostname: {0}")]
    InvalidHostname(String),
    #[error("Invalid path component: {0}")]
    InvalidPathComponent(String),
    #[error("Input too long: max {max} chars, got {actual}")]
    TooLong { max: usize, actual: usize },
    #[error("Input contains forbidden characters: {0}")]
    ForbiddenCharacters(String),
    #[error("Password does not meet requirements")]
    WeakPassword,
}

// ---------------------------------------------------------------------------
// Strict regex patterns -- allowlists only, never denylists.
// ---------------------------------------------------------------------------

/// Fully-qualified domain name (RFC 1035 / RFC 1123 compatible).
static DOMAIN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$",
    )
    .unwrap()
});

/// RFC 5321 compatible email address (simplified but safe).
static EMAIL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$",
    )
    .unwrap()
});

/// MySQL / MariaDB database name: alphanumeric, underscore, hyphen, 1-64 chars.
static DB_NAME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-zA-Z0-9_-]{1,64}$").unwrap());

/// Unix username: alphanumeric, dot, underscore, hyphen, 1-64 chars.
static USERNAME_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[a-zA-Z0-9._-]{1,64}$").unwrap());

/// Hostname (RFC 952 / RFC 1123).
static HOSTNAME_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,253}[a-zA-Z0-9])?$").unwrap());

/// Safe path component: no slashes, no traversal, no shell metacharacters.
static SAFE_PATH_COMPONENT_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-zA-Z0-9._-]{1,255}$").unwrap());

/// Shell metacharacters that must never appear in any input passed to subprocesses.
/// Even when using `Command::new().arg()` (which does NOT invoke a shell), we still
/// reject these as a defense-in-depth measure against accidental `sh -c` usage.
const SHELL_METACHARACTERS: &[char] = &[
    '`', '$', '(', ')', '{', '}', '[', ']', '|', ';', '&', '<', '>', '\n', '\r', '\0', '\\', '"',
    '\'',
];

// ---------------------------------------------------------------------------
// Public validation functions
// ---------------------------------------------------------------------------

/// Validate a fully-qualified domain name.
///
/// Rejects: empty, too long (>253), leading/trailing hyphens, bare TLDs,
/// whitespace, shell metacharacters, path traversal sequences.
pub fn validate_domain(domain: &str) -> Result<&str, ValidationError> {
    if domain.len() > 253 {
        return Err(ValidationError::TooLong {
            max: 253,
            actual: domain.len(),
        });
    }
    if !DOMAIN_RE.is_match(domain) {
        return Err(ValidationError::InvalidDomain(domain.to_string()));
    }
    Ok(domain)
}

/// Validate an email address.
///
/// Uses a simplified RFC 5321 pattern that accepts all reasonable addresses
/// while rejecting injection payloads.
pub fn validate_email(email: &str) -> Result<&str, ValidationError> {
    if email.len() > 254 {
        return Err(ValidationError::TooLong {
            max: 254,
            actual: email.len(),
        });
    }
    if !EMAIL_RE.is_match(email) {
        return Err(ValidationError::InvalidEmail(email.to_string()));
    }
    Ok(email)
}

/// Validate a database name (MySQL / MariaDB compatible).
///
/// Only alphanumeric characters, underscores, and hyphens are allowed.
/// Maximum 64 characters (MySQL limit).
pub fn validate_database_name(name: &str) -> Result<&str, ValidationError> {
    if !DB_NAME_RE.is_match(name) {
        return Err(ValidationError::InvalidDatabaseName(name.to_string()));
    }
    Ok(name)
}

/// Validate a Unix username.
///
/// Only alphanumeric characters, dots, underscores, and hyphens are allowed.
/// Maximum 64 characters.
pub fn validate_username(username: &str) -> Result<&str, ValidationError> {
    if !USERNAME_RE.is_match(username) {
        return Err(ValidationError::InvalidUsername(username.to_string()));
    }
    Ok(username)
}

/// Validate a hostname (RFC 952 / RFC 1123).
pub fn validate_hostname(hostname: &str) -> Result<&str, ValidationError> {
    if hostname.len() > 253 {
        return Err(ValidationError::TooLong {
            max: 253,
            actual: hostname.len(),
        });
    }
    if !HOSTNAME_RE.is_match(hostname) {
        return Err(ValidationError::InvalidHostname(hostname.to_string()));
    }
    Ok(hostname)
}

/// Validate a single path component (file or directory name, NOT a full path).
///
/// Rejects: traversal (`..`), slashes, backslashes, null bytes, and any
/// character not in the `[a-zA-Z0-9._-]` allowlist.
pub fn validate_path_component(component: &str) -> Result<&str, ValidationError> {
    if component.contains("..")
        || component.contains('/')
        || component.contains('\\')
        || component.contains('\0')
    {
        return Err(ValidationError::InvalidPathComponent(
            component.to_string(),
        ));
    }
    if !SAFE_PATH_COMPONENT_RE.is_match(component) {
        return Err(ValidationError::InvalidPathComponent(
            component.to_string(),
        ));
    }
    Ok(component)
}

/// Assert that a string contains no shell metacharacters.
///
/// This is a defense-in-depth check for any string that might be passed to
/// `Command::new().arg()`. Even though Rust's `Command` API does not invoke
/// a shell, this guard protects against accidental `sh -c` usage and provides
/// an extra safety layer.
pub fn assert_no_shell_metacharacters(input: &str) -> Result<&str, ValidationError> {
    for ch in SHELL_METACHARACTERS {
        if input.contains(*ch) {
            return Err(ValidationError::ForbiddenCharacters(format!(
                "contains forbidden character: {:?}",
                ch
            )));
        }
    }
    Ok(input)
}

/// Validate password strength requirements.
///
/// Requirements:
/// - At least 12 characters long
/// - Contains at least one uppercase letter
/// - Contains at least one lowercase letter
/// - Contains at least one ASCII digit
/// - Contains at least one non-alphanumeric (special) character
pub fn validate_password(password: &str) -> Result<(), ValidationError> {
    if password.len() < 12 {
        return Err(ValidationError::WeakPassword);
    }
    let has_upper = password.chars().any(|c| c.is_uppercase());
    let has_lower = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_special = password.chars().any(|c| !c.is_alphanumeric());

    if !(has_upper && has_lower && has_digit && has_special) {
        return Err(ValidationError::WeakPassword);
    }
    Ok(())
}

/// Validate and normalize a TLD input.
///
/// Strips leading dots, lowercases the result, and ensures it contains only
/// ASCII alphanumeric characters with a length between 1 and 63.
pub fn validate_tld(tld: &str) -> Result<String, ValidationError> {
    let tld = tld.trim_start_matches('.').to_lowercase();
    if tld.is_empty() || tld.len() > 63 {
        return Err(ValidationError::InvalidDomain(tld));
    }
    if !tld.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(ValidationError::InvalidDomain(tld));
    }
    Ok(tld)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- Domain validation --------------------------------------------------

    #[test]
    fn test_valid_domains() {
        assert!(validate_domain("example.com").is_ok());
        assert!(validate_domain("mail.example.co.uk").is_ok());
        assert!(validate_domain("sub-domain.example.org").is_ok());
        assert!(validate_domain("a.bc").is_ok());
        assert!(validate_domain("x1.y2.z3.example.com").is_ok());
    }

    #[test]
    fn test_invalid_domains() {
        assert!(validate_domain("").is_err());
        assert!(validate_domain("-example.com").is_err());
        assert!(validate_domain("example").is_err());
        assert!(validate_domain("exam ple.com").is_err());
        assert!(validate_domain("example.com; rm -rf /").is_err());
        assert!(validate_domain("../../../etc/passwd").is_err());
        assert!(validate_domain("example.com\ninjection").is_err());
        assert!(validate_domain(".example.com").is_err());
        assert!(validate_domain("example.com.").is_err());
    }

    #[test]
    fn test_domain_too_long() {
        let long_domain = format!("{}.com", "a".repeat(250));
        assert!(validate_domain(&long_domain).is_err());
    }

    // -- Email validation ---------------------------------------------------

    #[test]
    fn test_valid_emails() {
        assert!(validate_email("user@example.com").is_ok());
        assert!(validate_email("first.last@mail.example.com").is_ok());
        assert!(validate_email("user+tag@example.org").is_ok());
    }

    #[test]
    fn test_invalid_emails() {
        assert!(validate_email("").is_err());
        assert!(validate_email("notanemail").is_err());
        assert!(validate_email("user@").is_err());
        assert!(validate_email("@example.com").is_err());
        assert!(validate_email("user@example.com; DROP TABLE users;--").is_err());
        assert!(validate_email("user@example.com\n").is_err());
    }

    // -- Shell metacharacter rejection --------------------------------------

    #[test]
    fn test_shell_metacharacter_rejection() {
        assert!(assert_no_shell_metacharacters("safe-input.123").is_ok());
        assert!(assert_no_shell_metacharacters("simple_name").is_ok());
        assert!(assert_no_shell_metacharacters("$(whoami)").is_err());
        assert!(assert_no_shell_metacharacters("`id`").is_err());
        assert!(assert_no_shell_metacharacters("foo;bar").is_err());
        assert!(assert_no_shell_metacharacters("foo|bar").is_err());
        assert!(assert_no_shell_metacharacters("foo\nbar").is_err());
        assert!(assert_no_shell_metacharacters("foo\0bar").is_err());
        assert!(assert_no_shell_metacharacters("foo&bar").is_err());
        assert!(assert_no_shell_metacharacters("foo>bar").is_err());
        assert!(assert_no_shell_metacharacters("foo<bar").is_err());
    }

    // -- Path traversal rejection -------------------------------------------

    #[test]
    fn test_path_traversal_rejection() {
        assert!(validate_path_component("valid-name").is_ok());
        assert!(validate_path_component("file.txt").is_ok());
        assert!(validate_path_component("my_config-2").is_ok());
        assert!(validate_path_component("..").is_err());
        assert!(validate_path_component("../etc/passwd").is_err());
        assert!(validate_path_component("foo/bar").is_err());
        assert!(validate_path_component("foo\\bar").is_err());
        assert!(validate_path_component("").is_err());
        assert!(validate_path_component(" ").is_err());
    }

    // -- Database name validation -------------------------------------------

    #[test]
    fn test_database_name_validation() {
        assert!(validate_database_name("ceymail_mysite").is_ok());
        assert!(validate_database_name("ceymail-hyphen").is_ok());
        assert!(validate_database_name("db123").is_ok());
        assert!(validate_database_name("DROP TABLE users;--").is_err());
        assert!(validate_database_name("db name with spaces").is_err());
        assert!(validate_database_name("").is_err());
    }

    #[test]
    fn test_database_name_length_limit() {
        let long_name = "a".repeat(65);
        assert!(validate_database_name(&long_name).is_err());
        let max_name = "a".repeat(64);
        assert!(validate_database_name(&max_name).is_ok());
    }

    // -- Username validation ------------------------------------------------

    #[test]
    fn test_username_validation() {
        assert!(validate_username("alice").is_ok());
        assert!(validate_username("bob.smith").is_ok());
        assert!(validate_username("user_name").is_ok());
        assert!(validate_username("user-name").is_ok());
        assert!(validate_username("root; rm -rf /").is_err());
        assert!(validate_username("").is_err());
        assert!(validate_username("user name").is_err());
    }

    // -- Hostname validation ------------------------------------------------

    #[test]
    fn test_hostname_validation() {
        assert!(validate_hostname("mail").is_ok());
        assert!(validate_hostname("mail.example.com").is_ok());
        assert!(validate_hostname("192.168.1.1").is_ok());
        assert!(validate_hostname("-invalid").is_err());
        assert!(validate_hostname("").is_err());
    }

    // -- Password validation ------------------------------------------------

    #[test]
    fn test_password_validation() {
        assert!(validate_password("short").is_err());
        assert!(validate_password("onlylowercase1!").is_err()); // no uppercase
        assert!(validate_password("ONLYUPPERCASE1!").is_err()); // no lowercase
        assert!(validate_password("NoDigitsHere!!").is_err()); // no digit
        assert!(validate_password("NoSpecial1234A").is_err()); // no special char
        assert!(validate_password("Str0ng!Pass#2024").is_ok());
        assert!(validate_password("C0mpl3x@Passw0rd").is_ok());
    }

    // -- TLD validation -----------------------------------------------------

    #[test]
    fn test_tld_validation() {
        assert_eq!(validate_tld("com").unwrap(), "com");
        assert_eq!(validate_tld(".COM").unwrap(), "com");
        assert_eq!(validate_tld("...org").unwrap(), "org");
        assert!(validate_tld("").is_err());
        assert!(validate_tld("c-om").is_err());
        assert!(validate_tld("co m").is_err());
    }

    #[test]
    fn test_tld_length_limit() {
        let long_tld = "a".repeat(64);
        assert!(validate_tld(&long_tld).is_err());
        let max_tld = "a".repeat(63);
        assert!(validate_tld(&max_tld).is_ok());
    }
}
