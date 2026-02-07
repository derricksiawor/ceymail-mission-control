//! Encrypted credential storage using the `age` crate.
//!
//! Replaces the CeyMail bash scripts' broken `dbpass=/ceymail/enc` pattern and
//! plaintext credential files with proper age-encrypted, per-credential storage.
//!
//! # Design
//!
//! - Each credential is stored as an individual `.age` encrypted file under
//!   `/var/lib/ceymail-mc/credentials/`.
//! - The age identity (private key) is stored at `/etc/ceymail-mc/credentials.key`
//!   with mode `0600`, owned by root.
//! - Plaintext credential values are NEVER written to disk. They exist in memory
//!   only for the duration needed to encrypt/decrypt.
//! - Credential names are validated as safe path components before use, preventing
//!   directory traversal and injection attacks.

use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use age::secrecy::ExposeSecret;
use rand::Rng;
use thiserror::Error;
use tracing::{debug, info, warn};

use super::input;

/// Default directory for encrypted credential files.
pub const CREDENTIALS_DIR: &str = "/var/lib/ceymail-mc/credentials";

/// Default path for the age identity (private key) file.
pub const KEY_PATH: &str = "/etc/ceymail-mc/credentials.key";

/// Errors that can occur during credential operations.
#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Age encryption error: {0}")]
    Encrypt(String),

    #[error("Age decryption error: {0}")]
    Decrypt(String),

    #[error("Identity key error: {0}")]
    Identity(String),

    #[error("Credential not found: {0}")]
    NotFound(String),

    #[error("Invalid credential name: {0}")]
    InvalidName(String),

    #[error("Input validation error: {0}")]
    Validation(#[from] input::ValidationError),
}

/// Manages encrypted credential storage using age encryption.
///
/// Each credential is stored as an individual `.age` file, encrypted with a
/// single age identity. The identity key is loaded once at construction time
/// and kept in memory for the lifetime of the store.
pub struct CredentialStore {
    /// The age identity used for encryption and decryption.
    identity: age::x25519::Identity,
    /// The corresponding recipient (public key) for encryption.
    recipient: age::x25519::Recipient,
    /// Directory where encrypted credential files are stored.
    credentials_dir: PathBuf,
}

impl CredentialStore {
    /// Create a new `CredentialStore`, loading or generating the age identity.
    ///
    /// - If `key_path` exists and contains a valid age identity, it is loaded.
    /// - If `key_path` does not exist, a new identity is generated, written to
    ///   the file with mode `0600`, and used.
    /// - The credentials directory is created if it does not exist.
    pub fn new(key_path: &Path) -> Result<Self, CredentialError> {
        Self::with_credentials_dir(key_path, Path::new(CREDENTIALS_DIR))
    }

    /// Create a new `CredentialStore` with a custom credentials directory.
    ///
    /// This is primarily useful for testing.
    pub fn with_credentials_dir(
        key_path: &Path,
        credentials_dir: &Path,
    ) -> Result<Self, CredentialError> {
        let identity = if key_path.exists() {
            Self::load_identity(key_path)?
        } else {
            Self::generate_identity(key_path)?
        };

        let recipient = identity.to_public();

        // Ensure the credentials directory exists with restrictive permissions.
        if !credentials_dir.exists() {
            fs::create_dir_all(credentials_dir)?;
            fs::set_permissions(credentials_dir, fs::Permissions::from_mode(0o700))?;
            info!(
                path = %credentials_dir.display(),
                "Created credentials directory"
            );
        }

        Ok(Self {
            identity,
            recipient,
            credentials_dir: credentials_dir.to_path_buf(),
        })
    }

    /// Store an encrypted credential.
    ///
    /// The `name` is validated as a safe path component. The `value` is encrypted
    /// using the age recipient and written to `<credentials_dir>/<name>.age`.
    /// The plaintext value is never written to disk.
    pub fn store(&self, name: &str, value: &str) -> Result<(), CredentialError> {
        let name = self.validate_credential_name(name)?;
        let path = self.credential_path(&name);

        let encrypted = self.encrypt(value.as_bytes())?;

        // Write atomically: write to temp file then rename.
        let tmp_path = path.with_extension("age.tmp");
        fs::write(&tmp_path, &encrypted)?;
        fs::set_permissions(&tmp_path, fs::Permissions::from_mode(0o600))?;
        fs::rename(&tmp_path, &path)?;

        info!(credential = %name, "Stored encrypted credential");
        Ok(())
    }

    /// Retrieve and decrypt a credential.
    ///
    /// Returns the plaintext value. The caller should minimize the lifetime of
    /// the returned `String` and avoid logging it.
    pub fn retrieve(&self, name: &str) -> Result<String, CredentialError> {
        let name = self.validate_credential_name(name)?;
        let path = self.credential_path(&name);

        if !path.exists() {
            return Err(CredentialError::NotFound(name));
        }

        let encrypted = fs::read(&path)?;
        let decrypted = self.decrypt(&encrypted)?;

        let value = String::from_utf8(decrypted).map_err(|e| {
            CredentialError::Decrypt(format!("Decrypted value is not valid UTF-8: {}", e))
        })?;

        debug!(credential = %name, "Retrieved credential");
        Ok(value)
    }

    /// Delete a stored credential.
    ///
    /// Returns `Ok(())` even if the credential did not exist (idempotent).
    pub fn delete(&self, name: &str) -> Result<(), CredentialError> {
        let name = self.validate_credential_name(name)?;
        let path = self.credential_path(&name);

        if path.exists() {
            fs::remove_file(&path)?;
            info!(credential = %name, "Deleted credential");
        } else {
            debug!(credential = %name, "Credential already absent, nothing to delete");
        }
        Ok(())
    }

    /// List the names of all stored credentials.
    ///
    /// Returns credential names (without the `.age` extension) sorted alphabetically.
    pub fn list(&self) -> Result<Vec<String>, CredentialError> {
        let mut names = Vec::new();

        if !self.credentials_dir.exists() {
            return Ok(names);
        }

        for entry in fs::read_dir(&self.credentials_dir)? {
            let entry = entry?;
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();

            if file_name.ends_with(".age") && !file_name.ends_with(".age.tmp") {
                let name = file_name.trim_end_matches(".age").to_string();
                names.push(name);
            }
        }

        names.sort();
        Ok(names)
    }

    /// Check whether a credential exists.
    pub fn exists(&self, name: &str) -> Result<bool, CredentialError> {
        let name = self.validate_credential_name(name)?;
        Ok(self.credential_path(&name).exists())
    }

    // -----------------------------------------------------------------------
    // Password generation
    // -----------------------------------------------------------------------

    /// Generate a cryptographically random password of the given length.
    ///
    /// The password contains a mix of uppercase, lowercase, digits, and special
    /// characters, guaranteeing at least one of each category.
    pub fn generate_password(length: usize) -> String {
        let length = length.max(4);

        let mut rng = rand::thread_rng();

        // Character pools.
        const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
        const DIGIT: &[u8] = b"0123456789";
        const SPECIAL: &[u8] = b"!@#$%^&*()-_=+[]{}|;:,.<>?";
        const ALL: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{}|;:,.<>?";

        let mut password = Vec::with_capacity(length);

        // Guarantee at least one character from each category.
        password.push(UPPER[rng.gen_range(0..UPPER.len())]);
        password.push(LOWER[rng.gen_range(0..LOWER.len())]);
        password.push(DIGIT[rng.gen_range(0..DIGIT.len())]);
        password.push(SPECIAL[rng.gen_range(0..SPECIAL.len())]);

        // Fill the rest randomly from all categories.
        for _ in 4..length {
            password.push(ALL[rng.gen_range(0..ALL.len())]);
        }

        // Shuffle to avoid predictable category positions.
        // Fisher-Yates shuffle using cryptographic randomness.
        for i in (1..password.len()).rev() {
            let j = rng.gen_range(0..=i);
            password.swap(i, j);
        }

        String::from_utf8(password).expect("password bytes are all ASCII")
    }

    /// Generate a 32-character hexadecimal database password.
    ///
    /// This is a convenience method for generating passwords suitable for
    /// MySQL/MariaDB credentials, matching the 128-bit entropy requirement.
    pub fn generate_db_password() -> String {
        let mut bytes = [0u8; 16];
        rand::thread_rng().fill(&mut bytes);
        hex::encode(bytes)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Build the filesystem path for a credential file.
    fn credential_path(&self, name: &str) -> PathBuf {
        self.credentials_dir.join(format!("{}.age", name))
    }

    /// Validate a credential name as a safe path component.
    fn validate_credential_name(&self, name: &str) -> Result<String, CredentialError> {
        input::validate_path_component(name).map_err(|e| {
            CredentialError::InvalidName(format!("{}: {}", name, e))
        })?;
        Ok(name.to_string())
    }

    /// Load an existing age identity from a file.
    fn load_identity(path: &Path) -> Result<age::x25519::Identity, CredentialError> {
        let key_data = fs::read_to_string(path).map_err(|e| {
            CredentialError::Identity(format!("Failed to read key file {}: {}", path.display(), e))
        })?;

        let identity = key_data
            .lines()
            .filter(|line| !line.starts_with('#') && !line.is_empty())
            .next()
            .and_then(|line| line.parse::<age::x25519::Identity>().ok())
            .ok_or_else(|| {
                CredentialError::Identity(format!(
                    "No valid age identity found in {}",
                    path.display()
                ))
            })?;

        info!(path = %path.display(), "Loaded age identity");
        Ok(identity)
    }

    /// Generate a new age identity and write it to a file with mode 0600.
    fn generate_identity(path: &Path) -> Result<age::x25519::Identity, CredentialError> {
        let identity = age::x25519::Identity::generate();
        let public_key = identity.to_public();

        // Ensure parent directory exists.
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let key_content = format!(
            "# age identity key for CeyMail Mission Control\n\
             # Public key: {}\n\
             # Generated: {}\n\
             # WARNING: Keep this file secret. Do NOT share or commit it.\n\
             {}\n",
            public_key,
            chrono::Utc::now().to_rfc3339(),
            identity.to_string().expose_secret(),
        );

        fs::write(path, key_content.as_bytes())?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;

        info!(
            path = %path.display(),
            public_key = %public_key,
            "Generated new age identity"
        );
        Ok(identity)
    }

    /// Encrypt plaintext bytes using the stored recipient.
    fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, CredentialError> {
        let encryptor =
            age::Encryptor::with_recipients(vec![Box::new(self.recipient.clone())])
                .map_err(|e| CredentialError::Encrypt(format!("Failed to create encryptor: {}", e)))?;

        let mut encrypted = Vec::new();
        let mut writer = encryptor
            .wrap_output(&mut encrypted)
            .map_err(|e| CredentialError::Encrypt(format!("Failed to wrap output: {}", e)))?;

        writer
            .write_all(plaintext)
            .map_err(|e| CredentialError::Encrypt(format!("Failed to write plaintext: {}", e)))?;

        writer
            .finish()
            .map_err(|e| CredentialError::Encrypt(format!("Failed to finish encryption: {}", e)))?;

        Ok(encrypted)
    }

    /// Decrypt ciphertext bytes using the stored identity.
    fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>, CredentialError> {
        let decryptor = match age::Decryptor::new(ciphertext)
            .map_err(|e| CredentialError::Decrypt(format!("Failed to create decryptor: {}", e)))?
        {
            age::Decryptor::Recipients(d) => d,
            _ => {
                return Err(CredentialError::Decrypt(
                    "Unexpected decryptor type (passphrase-encrypted?)".to_string(),
                ));
            }
        };

        let mut reader = decryptor
            .decrypt(std::iter::once(&self.identity as &dyn age::Identity))
            .map_err(|e| CredentialError::Decrypt(format!("Decryption failed: {}", e)))?;

        let mut decrypted = Vec::new();
        reader
            .read_to_end(&mut decrypted)
            .map_err(|e| CredentialError::Decrypt(format!("Failed to read decrypted data: {}", e)))?;

        Ok(decrypted)
    }
}

impl std::fmt::Debug for CredentialStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CredentialStore")
            .field("credentials_dir", &self.credentials_dir)
            .field("recipient", &self.recipient.to_string())
            .finish()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Create a CredentialStore backed by a temporary directory for testing.
    fn test_store() -> (CredentialStore, TempDir) {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("test.key");
        let creds_dir = dir.path().join("credentials");
        let store = CredentialStore::with_credentials_dir(&key_path, &creds_dir).unwrap();
        (store, dir)
    }

    #[test]
    fn test_store_and_retrieve() {
        let (store, _dir) = test_store();

        store.store("db-password", "s3cret-value-123").unwrap();
        let retrieved = store.retrieve("db-password").unwrap();
        assert_eq!(retrieved, "s3cret-value-123");
    }

    #[test]
    fn test_store_overwrites_existing() {
        let (store, _dir) = test_store();

        store.store("api-key", "old-value").unwrap();
        store.store("api-key", "new-value").unwrap();
        let retrieved = store.retrieve("api-key").unwrap();
        assert_eq!(retrieved, "new-value");
    }

    #[test]
    fn test_retrieve_nonexistent() {
        let (store, _dir) = test_store();

        let result = store.retrieve("does-not-exist");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), CredentialError::NotFound(_)));
    }

    #[test]
    fn test_delete() {
        let (store, _dir) = test_store();

        store.store("to-delete", "value").unwrap();
        assert!(store.exists("to-delete").unwrap());

        store.delete("to-delete").unwrap();
        assert!(!store.exists("to-delete").unwrap());
    }

    #[test]
    fn test_delete_idempotent() {
        let (store, _dir) = test_store();
        // Deleting a non-existent credential should not error.
        store.delete("never-existed").unwrap();
    }

    #[test]
    fn test_list() {
        let (store, _dir) = test_store();

        store.store("alpha", "a").unwrap();
        store.store("beta", "b").unwrap();
        store.store("gamma", "c").unwrap();

        let names = store.list().unwrap();
        assert_eq!(names, vec!["alpha", "beta", "gamma"]);
    }

    #[test]
    fn test_list_empty() {
        let (store, _dir) = test_store();
        let names = store.list().unwrap();
        assert!(names.is_empty());
    }

    #[test]
    fn test_invalid_credential_names() {
        let (store, _dir) = test_store();

        assert!(store.store("../etc/passwd", "hack").is_err());
        assert!(store.store("foo/bar", "hack").is_err());
        assert!(store.store("", "hack").is_err());
        assert!(store.store("name with spaces", "hack").is_err());
        assert!(store.store("$(whoami)", "hack").is_err());
    }

    #[test]
    fn test_exists() {
        let (store, _dir) = test_store();

        assert!(!store.exists("missing").unwrap());
        store.store("present", "val").unwrap();
        assert!(store.exists("present").unwrap());
    }

    #[test]
    fn test_credential_file_permissions() {
        let (store, dir) = test_store();

        store.store("perm-test", "secret").unwrap();
        let path = dir.path().join("credentials").join("perm-test.age");
        let metadata = fs::metadata(&path).unwrap();
        let mode = metadata.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "Credential file should have mode 0600");
    }

    #[test]
    fn test_identity_reloads() {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("reload.key");
        let creds_dir = dir.path().join("credentials");

        // First store creates the key.
        let store1 = CredentialStore::with_credentials_dir(&key_path, &creds_dir).unwrap();
        store1.store("persist", "my-secret").unwrap();

        // Second store reloads the same key and should be able to decrypt.
        let store2 = CredentialStore::with_credentials_dir(&key_path, &creds_dir).unwrap();
        let value = store2.retrieve("persist").unwrap();
        assert_eq!(value, "my-secret");
    }

    #[test]
    fn test_generate_password_length() {
        let pw = CredentialStore::generate_password(20);
        assert_eq!(pw.len(), 20);
    }

    #[test]
    fn test_generate_password_meets_complexity() {
        // Generate many passwords and verify they all meet complexity requirements.
        for _ in 0..50 {
            let pw = CredentialStore::generate_password(16);
            assert!(pw.chars().any(|c| c.is_uppercase()), "Missing uppercase in: {}", pw);
            assert!(pw.chars().any(|c| c.is_lowercase()), "Missing lowercase in: {}", pw);
            assert!(pw.chars().any(|c| c.is_ascii_digit()), "Missing digit in: {}", pw);
            assert!(pw.chars().any(|c| !c.is_alphanumeric()), "Missing special in: {}", pw);
        }
    }

    #[test]
    fn test_generate_db_password() {
        let pw = CredentialStore::generate_db_password();
        assert_eq!(pw.len(), 32);
        assert!(pw.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_generate_db_password_uniqueness() {
        // Verify that consecutive calls produce different passwords.
        let pw1 = CredentialStore::generate_db_password();
        let pw2 = CredentialStore::generate_db_password();
        assert_ne!(pw1, pw2, "Two generated passwords should differ");
    }

    #[test]
    fn test_key_file_permissions() {
        let dir = TempDir::new().unwrap();
        let key_path = dir.path().join("perms.key");
        let creds_dir = dir.path().join("credentials");

        let _store = CredentialStore::with_credentials_dir(&key_path, &creds_dir).unwrap();

        let metadata = fs::metadata(&key_path).unwrap();
        let mode = metadata.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "Key file should have mode 0600");
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip_binary() {
        let (store, _dir) = test_store();

        // Store a value containing non-trivial UTF-8 characters.
        let value = "p@$$w0rd!#%^&*()-_=+\u{00e9}\u{00f1}";
        store.store("unicode-test", value).unwrap();
        let retrieved = store.retrieve("unicode-test").unwrap();
        assert_eq!(retrieved, value);
    }
}
