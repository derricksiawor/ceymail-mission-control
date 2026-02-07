//! Security utilities: input validation, encrypted credential storage, and audit logging.
//!
//! These modules replace the CeyMail bash scripts' lack of input sanitization,
//! plaintext credential storage, and absent audit trails with strict allowlist-based
//! validation, age-encrypted credential management, and structured audit logging.

pub mod input;
pub mod credentials;
pub mod audit;
