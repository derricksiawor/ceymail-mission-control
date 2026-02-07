use sha_crypt::{sha512_simple, sha512_check, Sha512Params};
use thiserror::Error;
use rand::Rng;

#[derive(Debug, Error)]
pub enum PasswordError {
    #[error("Hashing failed: {0}")]
    HashFailed(String),
    #[error("Verification failed")]
    VerificationFailed,
    #[error("Invalid hash format")]
    InvalidFormat,
}

/// Hash a password using SHA-512 crypt (Dovecot doveadm pw -s SHA512-CRYPT compatible)
pub fn hash_password(password: &str) -> Result<String, PasswordError> {
    let params = Sha512Params::new(5000)
        .map_err(|e| PasswordError::HashFailed(format!("Invalid params: {:?}", e)))?;

    let hash = sha512_simple(password, &params)
        .map_err(|e| PasswordError::HashFailed(format!("{:?}", e)))?;

    // Dovecot expects the {SHA512-CRYPT} prefix
    Ok(format!("{{SHA512-CRYPT}}{}", hash))
}

/// Verify a password against a Dovecot SHA512-CRYPT hash
pub fn verify_password(password: &str, hash: &str) -> Result<bool, PasswordError> {
    let hash = hash
        .strip_prefix("{SHA512-CRYPT}")
        .unwrap_or(hash);

    match sha512_check(password, hash) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// Generate a random password of given length using cryptographically secure RNG
pub fn generate_random_password(length: usize) -> String {
    let charset: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..charset.len());
            charset[idx] as char
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify() {
        let password = "TestPassword123!";
        let hash = hash_password(password).unwrap();
        assert!(hash.starts_with("{SHA512-CRYPT}$6$"));
        assert!(verify_password(password, &hash).unwrap());
        assert!(!verify_password("wrong", &hash).unwrap());
    }

    #[test]
    fn test_random_password_length() {
        let pw = generate_random_password(32);
        assert_eq!(pw.len(), 32);
    }

    #[test]
    fn test_different_passwords_different_hashes() {
        let h1 = hash_password("password1").unwrap();
        let h2 = hash_password("password1").unwrap();
        // Same password should produce different hashes (different salts)
        assert_ne!(h1, h2);
    }
}
