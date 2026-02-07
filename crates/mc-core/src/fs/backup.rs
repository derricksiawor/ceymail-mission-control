use chrono::Utc;
use flate2::write::GzEncoder;
use flate2::read::GzDecoder;
use flate2::Compression;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use tar::{Archive, Builder};
use thiserror::Error;
use tracing::{info, debug};
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum BackupError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("Backup not found: {0}")]
    NotFound(String),
    #[error("Invalid backup archive: {0}")]
    InvalidArchive(String),
    #[error("Restore failed: {0}")]
    RestoreFailed(String),
}

#[derive(Debug, Clone)]
pub struct BackupMetadata {
    pub id: String,
    pub created_at: chrono::DateTime<Utc>,
    pub size_bytes: u64,
    pub includes_database: bool,
    pub includes_config: bool,
    pub includes_dkim: bool,
    pub includes_mailboxes: bool,
}

const BACKUP_DIR: &str = "/var/lib/ceymail-mc/backups";

/// Directories to include in config backups
const CONFIG_PATHS: &[&str] = &[
    "/etc/postfix",
    "/etc/dovecot",
    "/etc/opendkim",
    "/etc/opendkim.conf",
    "/etc/spamassassin",
];

const DKIM_PATH: &str = "/etc/mail/dkim-keys";
const MAILBOX_PATH: &str = "/var/mail/vhosts";

pub fn ensure_backup_dir() -> Result<(), BackupError> {
    fs::create_dir_all(BACKUP_DIR)?;
    // Restrict backup directory access to service user only
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(BACKUP_DIR, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Create a backup archive
pub fn create_backup(
    include_config: bool,
    include_dkim: bool,
    include_mailboxes: bool,
) -> Result<BackupMetadata, BackupError> {
    ensure_backup_dir()?;

    let id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let filename = format!("ceymail-backup-{}_{}.tar.gz", timestamp, &id[..8]);
    let backup_path = Path::new(BACKUP_DIR).join(&filename);

    let file = File::create(&backup_path)?;
    let enc = GzEncoder::new(file, Compression::default());
    let mut tar = Builder::new(enc);

    if include_config {
        for config_path in CONFIG_PATHS {
            let path = Path::new(config_path);
            if path.exists() {
                if path.is_dir() {
                    tar.append_dir_all(config_path.trim_start_matches('/'), path)?;
                } else {
                    tar.append_path_with_name(path, config_path.trim_start_matches('/'))?;
                }
                debug!("Added to backup: {}", config_path);
            }
        }
    }

    if include_dkim {
        let dkim_path = Path::new(DKIM_PATH);
        if dkim_path.exists() {
            tar.append_dir_all(DKIM_PATH.trim_start_matches('/'), dkim_path)?;
            debug!("Added DKIM keys to backup");
        }
    }

    if include_mailboxes {
        let mail_path = Path::new(MAILBOX_PATH);
        if mail_path.exists() {
            tar.append_dir_all(MAILBOX_PATH.trim_start_matches('/'), mail_path)?;
            debug!("Added mailboxes to backup");
        }
    }

    let enc = tar.into_inner()?;
    enc.finish()?;

    let size = fs::metadata(&backup_path)?.len();

    let metadata = BackupMetadata {
        id,
        created_at: Utc::now(),
        size_bytes: size,
        includes_database: false, // DB backup handled separately via mysqldump
        includes_config: include_config,
        includes_dkim: include_dkim,
        includes_mailboxes: include_mailboxes,
    };

    info!("Created backup: {} ({} bytes)", filename, size);
    Ok(metadata)
}

/// List all available backups
pub fn list_backups() -> Result<Vec<BackupMetadata>, BackupError> {
    ensure_backup_dir()?;
    let mut backups = Vec::new();

    for entry in fs::read_dir(BACKUP_DIR)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("gz") {
            let meta = fs::metadata(&path)?;
            let filename = match path.file_name() {
                Some(name) => name.to_string_lossy(),
                None => continue,
            };

            // Extract ID from filename
            let id = filename
                .strip_prefix("ceymail-backup-")
                .and_then(|s| s.strip_suffix(".tar.gz"))
                .and_then(|s| s.split('_').last())
                .unwrap_or("unknown")
                .to_string();

            backups.push(BackupMetadata {
                id,
                created_at: meta.modified()?.into(),
                size_bytes: meta.len(),
                includes_database: false,
                includes_config: true,
                includes_dkim: true,
                includes_mailboxes: false,
            });
        }
    }

    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

/// Restore a backup archive to the filesystem
pub fn restore_backup(backup_id: &str) -> Result<(), BackupError> {
    ensure_backup_dir()?;

    // Validate backup_id to prevent path traversal
    crate::security::input::validate_path_component(backup_id)
        .map_err(|e| BackupError::RestoreFailed(format!("Invalid backup ID: {}", e)))?;

    let backup_file = find_backup_file(backup_id)?;

    let file = File::open(&backup_file)?;
    let dec = GzDecoder::new(file);
    let mut archive = Archive::new(dec);

    // Validate all entries before extracting - reject path traversal
    archive.set_preserve_permissions(false);
    for entry in archive.entries().map_err(|e| {
        BackupError::RestoreFailed(format!("Failed to read archive entries: {}", e))
    })? {
        let entry = entry.map_err(|e| {
            BackupError::RestoreFailed(format!("Failed to read entry: {}", e))
        })?;
        let path = entry.path().map_err(|e| {
            BackupError::RestoreFailed(format!("Invalid entry path: {}", e))
        })?;
        // Reject absolute paths and path traversal
        if path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(BackupError::RestoreFailed(format!(
                "Archive contains unsafe path: {}", path.display()
            )));
        }
    }

    // Re-open and extract after validation
    let file = File::open(&backup_file)?;
    let dec = GzDecoder::new(file);
    let mut archive = Archive::new(dec);
    archive.unpack("/").map_err(|e| {
        BackupError::RestoreFailed(format!("Failed to extract archive: {}", e))
    })?;

    info!("Restored backup: {}", backup_id);
    Ok(())
}

fn find_backup_file(backup_id: &str) -> Result<PathBuf, BackupError> {
    for entry in fs::read_dir(BACKUP_DIR)? {
        let entry = entry?;
        let path = entry.path();
        if let Some(name) = path.file_name() {
            if name.to_string_lossy().contains(backup_id) {
                return Ok(path);
            }
        }
    }
    Err(BackupError::NotFound(backup_id.to_string()))
}
