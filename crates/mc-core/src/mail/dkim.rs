use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use thiserror::Error;
use tracing::{info, debug};

use crate::security::input::{validate_domain, validate_path_component};

#[derive(Debug, Error)]
pub enum DkimError {
    #[error("Domain validation failed: {0}")]
    InvalidDomain(String),
    #[error("opendkim-genkey not found. Is opendkim-tools installed?")]
    ToolNotFound,
    #[error("Key generation failed: {0}")]
    GenerationFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Key already exists for domain: {0}")]
    KeyExists(String),
}

#[derive(Debug, Clone)]
pub struct DkimKeyInfo {
    pub domain: String,
    pub selector: String,
    pub private_key_path: PathBuf,
    pub public_key_path: PathBuf,
    pub dns_record: String,
}

const DKIM_BASE_DIR: &str = "/etc/mail/dkim-keys";

/// Generate DKIM keys for a domain using opendkim-genkey
pub fn generate_dkim_key(domain: &str, selector: &str) -> Result<DkimKeyInfo, DkimError> {
    // Validate inputs strictly
    validate_domain(domain).map_err(|e| DkimError::InvalidDomain(e.to_string()))?;
    validate_path_component(selector).map_err(|e| DkimError::InvalidDomain(e.to_string()))?;

    let domain_dir = Path::new(DKIM_BASE_DIR).join(domain);

    if domain_dir.join(format!("{}.private", domain)).exists() {
        return Err(DkimError::KeyExists(domain.to_string()));
    }

    // Create directory
    fs::create_dir_all(&domain_dir)?;

    // Run opendkim-genkey with explicit args (no shell interpolation)
    let output = Command::new("opendkim-genkey")
        .arg("-s")
        .arg(selector)
        .arg("-d")
        .arg(domain)
        .current_dir(&domain_dir)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                DkimError::ToolNotFound
            } else {
                DkimError::Io(e)
            }
        })?;

    if !output.status.success() {
        return Err(DkimError::GenerationFailed(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }

    // Rename files from selector.private/txt to domain.private/txt
    let src_private = domain_dir.join(format!("{}.private", selector));
    let src_txt = domain_dir.join(format!("{}.txt", selector));
    let dst_private = domain_dir.join(format!("{}.private", domain));
    let dst_txt = domain_dir.join(format!("{}.txt", domain));

    if src_private.exists() {
        fs::rename(&src_private, &dst_private)?;
    }
    if src_txt.exists() {
        fs::rename(&src_txt, &dst_txt)?;
    }

    // Read the DNS record
    let dns_record = fs::read_to_string(&dst_txt).unwrap_or_default();

    // Set permissions
    set_dkim_permissions(&domain_dir)?;

    info!("Generated DKIM key for domain: {} with selector: {}", domain, selector);

    Ok(DkimKeyInfo {
        domain: domain.to_string(),
        selector: selector.to_string(),
        private_key_path: dst_private,
        public_key_path: dst_txt,
        dns_record,
    })
}

/// Delete DKIM keys for a domain
pub fn delete_dkim_key(domain: &str) -> Result<(), DkimError> {
    validate_domain(domain).map_err(|e| DkimError::InvalidDomain(e.to_string()))?;

    let domain_dir = Path::new(DKIM_BASE_DIR).join(domain);
    if domain_dir.exists() {
        fs::remove_dir_all(&domain_dir)?;
        info!("Deleted DKIM keys for domain: {}", domain);
    }
    Ok(())
}

/// List all domains with DKIM keys
pub fn list_dkim_domains() -> Result<Vec<DkimKeyInfo>, DkimError> {
    let base = Path::new(DKIM_BASE_DIR);
    if !base.exists() {
        return Ok(Vec::new());
    }

    let mut keys = Vec::new();
    for entry in fs::read_dir(base)? {
        let entry = entry?;
        if entry.path().is_dir() {
            let domain = entry.file_name().to_string_lossy().to_string();
            let txt_path = entry.path().join(format!("{}.txt", domain));
            let private_path = entry.path().join(format!("{}.private", domain));

            let dns_record = if txt_path.exists() {
                fs::read_to_string(&txt_path).unwrap_or_default()
            } else {
                String::new()
            };

            keys.push(DkimKeyInfo {
                domain: domain.clone(),
                selector: "mail".to_string(),
                private_key_path: private_path,
                public_key_path: txt_path,
                dns_record,
            });
        }
    }
    Ok(keys)
}

fn set_dkim_permissions(path: &Path) -> Result<(), DkimError> {
    // Use Command to avoid needing CAP_CHOWN in the library itself
    let output = Command::new("chown")
        .arg("-R")
        .arg("opendkim:opendkim")
        .arg(path)
        .output()?;

    if !output.status.success() {
        debug!("chown on DKIM dir failed (may need elevated privileges)");
    }

    let output = Command::new("chmod")
        .arg("-R")
        .arg("700")
        .arg(path)
        .output()?;

    if !output.status.success() {
        debug!("chmod on DKIM dir failed (may need elevated privileges)");
    }

    Ok(())
}
