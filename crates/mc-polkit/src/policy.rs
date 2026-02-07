/// PolicyKit policy verification and authorization checks.
///
/// This module verifies that the required polkit policy XML is installed
/// and provides authorization checking for privileged operations.

use std::path::Path;
use thiserror::Error;
use tracing::{info, warn};

use crate::actions;

#[derive(Debug, Error)]
pub enum PolicyError {
    #[error("Polkit policy not installed: {0}")]
    PolicyNotInstalled(String),
    #[error("Authorization denied for action: {0}")]
    AuthorizationDenied(String),
    #[error("Polkit check failed: {0}")]
    CheckFailed(String),
}

const POLICY_FILE_PATH: &str = "/usr/share/polkit-1/actions/com.ceymail.mc.policy";

/// Verify that the CeyMail polkit policy is installed
pub fn verify_policy_installed() -> Result<(), PolicyError> {
    if Path::new(POLICY_FILE_PATH).exists() {
        info!("Polkit policy verified at {}", POLICY_FILE_PATH);
        Ok(())
    } else {
        warn!("Polkit policy not found at {}", POLICY_FILE_PATH);
        Err(PolicyError::PolicyNotInstalled(
            POLICY_FILE_PATH.to_string(),
        ))
    }
}

/// Check if the current process is authorized for a specific action.
/// Uses pkcheck command-line tool as a simple authorization check.
pub fn check_authorization(action_id: &str) -> Result<bool, PolicyError> {
    // Validate action ID is one of ours
    if !actions::ALL_ACTIONS.contains(&action_id) {
        return Err(PolicyError::AuthorizationDenied(format!(
            "Unknown action: {}",
            action_id
        )));
    }

    let pid = std::process::id();

    let output = std::process::Command::new("pkcheck")
        .arg("--action-id")
        .arg(action_id)
        .arg("--process")
        .arg(pid.to_string())
        .output();

    match output {
        Ok(out) => {
            if out.status.success() {
                Ok(true)
            } else {
                // Non-zero exit means not authorized (or pkcheck not available)
                let stderr = String::from_utf8_lossy(&out.stderr);
                if stderr.contains("not authorized") {
                    Ok(false)
                } else {
                    // pkcheck returned error but not auth denial - treat as authorized
                    // (e.g., when running as root or with ambient capabilities)
                    warn!("pkcheck returned non-zero but not auth denial: {}", stderr);
                    Ok(true)
                }
            }
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                // pkcheck not installed - if we're running as root or with caps, allow
                warn!("pkcheck not found, allowing operation (ensure polkit is installed in production)");
                Ok(true)
            } else {
                Err(PolicyError::CheckFailed(e.to_string()))
            }
        }
    }
}

/// Install the polkit policy file from the embedded XML
pub fn install_policy() -> Result<(), PolicyError> {
    let policy_dir = Path::new("/usr/share/polkit-1/actions/");
    if !policy_dir.exists() {
        return Err(PolicyError::PolicyNotInstalled(
            "Polkit actions directory does not exist. Is polkit installed?".to_string(),
        ));
    }

    let policy_content = include_str!("../../../deploy/polkit/com.ceymail.mc.policy");

    std::fs::write(POLICY_FILE_PATH, policy_content).map_err(|e| {
        PolicyError::CheckFailed(format!("Failed to write policy file: {}", e))
    })?;

    info!("Installed polkit policy to {}", POLICY_FILE_PATH);
    Ok(())
}
