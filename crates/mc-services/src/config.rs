use mc_core::config::parser::{self, ConfigFile};
use mc_core::config::postfix::PostfixConfig;
use mc_core::config::dovecot::DovecotConfig;
use mc_core::config::opendkim::OpendkimConfig;
use mc_core::fs::atomic;
use std::collections::BTreeMap;
use std::path::Path;
use thiserror::Error;
use tracing::{info, warn};
use std::process::Command;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("Config file not found: {0}")]
    NotFound(String),
    #[error("Parse error: {0}")]
    ParseError(String),
    #[error("Validation failed: {0}")]
    ValidationFailed(String),
    #[error("Write error: {0}")]
    WriteError(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Copy)]
pub enum ConfigFileType {
    PostfixMain,
    PostfixMaster,
    DovecotMain,
    OpendkimConf,
    SpamassassinLocal,
    ApacheVhost,
}

impl ConfigFileType {
    pub fn path(&self) -> &str {
        match self {
            Self::PostfixMain => "/etc/postfix/main.cf",
            Self::PostfixMaster => "/etc/postfix/master.cf",
            Self::DovecotMain => "/etc/dovecot/dovecot.conf",
            Self::OpendkimConf => "/etc/opendkim.conf",
            Self::SpamassassinLocal => "/etc/spamassassin/local.cf",
            Self::ApacheVhost => "/etc/apache2/sites-available/",
        }
    }
}

pub struct ConfigService;

impl ConfigService {
    pub fn new() -> Self {
        Self
    }

    /// Read a config file and return its key-value entries
    pub async fn get_config(
        &self,
        file_type: ConfigFileType,
    ) -> Result<(BTreeMap<String, String>, String), ConfigError> {
        let path = file_type.path();
        let content = std::fs::read_to_string(path)
            .map_err(|_| ConfigError::NotFound(path.to_string()))?;

        let config = parser::parse_config(&content)
            .map_err(|e| ConfigError::ParseError(e))?;

        Ok((config.to_map(), content))
    }

    /// Update a config file with validation
    pub async fn update_config(
        &self,
        file_type: ConfigFileType,
        entries: BTreeMap<String, String>,
        validate: bool,
    ) -> Result<Vec<String>, ConfigError> {
        let path = file_type.path();
        let mut warnings = Vec::new();

        // Read existing config
        let content = std::fs::read_to_string(path)
            .map_err(|_| ConfigError::NotFound(path.to_string()))?;

        let mut config = parser::parse_config(&content)
            .map_err(|e| ConfigError::ParseError(e))?;

        // Apply updates
        for (key, value) in &entries {
            config.set(key, value);
        }

        let new_content = config.serialize();

        if validate {
            // Validate by writing to temp and running check command
            let temp_path = format!("{}.mc-tmp", path);
            std::fs::write(&temp_path, &new_content)?;

            let validation_result = match file_type {
                ConfigFileType::PostfixMain => validate_postfix(&temp_path),
                ConfigFileType::DovecotMain => validate_dovecot(&temp_path),
                _ => Ok(Vec::new()),
            };

            // Clean up temp file
            let _ = std::fs::remove_file(&temp_path);

            match validation_result {
                Ok(warns) => warnings.extend(warns),
                Err(e) => return Err(e),
            }
        }

        // Atomic write with backup
        atomic::atomic_write_with_backup(
            Path::new(path),
            new_content.as_bytes(),
            Some(0o644),
        )
        .map_err(|e| ConfigError::WriteError(e.to_string()))?;

        info!("Updated config file: {}", path);
        Ok(warnings)
    }
}

/// Validate Postfix config by pointing postconf at the temp directory
fn validate_postfix(temp_path: &str) -> Result<Vec<String>, ConfigError> {
    // postconf -c requires a directory, not a file path
    // Create a temp dir and copy the temp config there as main.cf
    let temp_dir = format!("{}.d", temp_path);
    let _ = std::fs::create_dir_all(&temp_dir);
    let _ = std::fs::copy(temp_path, format!("{}/main.cf", temp_dir));

    let output = Command::new("postconf")
        .args(["-c", &temp_dir, "-n"])
        .output();

    // Clean up temp directory
    let _ = std::fs::remove_dir_all(&temp_dir);

    match output {
        Ok(out) if out.status.success() => Ok(Vec::new()),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Err(ConfigError::ValidationFailed(format!(
                "Postfix config validation failed: {}", stderr
            )))
        }
        Err(_) => {
            Ok(vec!["Warning: postconf not available, skipping validation".to_string()])
        }
    }
}

/// Validate Dovecot config using doveconf -c <path>
fn validate_dovecot(temp_path: &str) -> Result<Vec<String>, ConfigError> {
    let output = Command::new("doveconf")
        .args(["-c", temp_path, "-n"])
        .output();

    match output {
        Ok(out) if out.status.success() => Ok(Vec::new()),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Err(ConfigError::ValidationFailed(format!(
                "Dovecot config validation failed: {}", stderr
            )))
        }
        Err(_) => {
            Ok(vec!["Warning: doveconf not available, skipping validation".to_string()])
        }
    }
}
