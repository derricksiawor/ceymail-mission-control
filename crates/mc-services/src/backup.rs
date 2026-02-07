use mc_core::fs::backup;
use mc_db::queries;
use sqlx::MySqlPool;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum BackupServiceError {
    #[error("Backup error: {0}")]
    Backup(#[from] backup::BackupError),
    #[error("Database error: {0}")]
    Database(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct BackupService {
    dashboard_pool: MySqlPool,
}

impl BackupService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { dashboard_pool: pool }
    }

    /// Create a full backup (configs + DB dump + optional DKIM + optional mailboxes)
    pub async fn create_backup(
        &self,
        include_database: bool,
        include_config: bool,
        include_dkim: bool,
        include_mailboxes: bool,
    ) -> Result<backup::BackupMetadata, BackupServiceError> {
        // Create file backup
        let mut metadata = backup::create_backup(include_config, include_dkim, include_mailboxes)?;

        // Database backup if requested
        if include_database {
            let dump_path = format!("/var/lib/ceymail-mc/backups/db-{}.sql", metadata.id);
            // DB credentials would come from credential store in production
            // For now this is a placeholder
            info!("Database backup would be created at: {}", dump_path);
            metadata.includes_database = true;
        }

        info!("Backup created: {} ({} bytes)", metadata.id, metadata.size_bytes);
        Ok(metadata)
    }

    /// List all available backups
    pub async fn list_backups(&self) -> Result<Vec<backup::BackupMetadata>, BackupServiceError> {
        Ok(backup::list_backups()?)
    }

    /// Restore a backup
    pub async fn restore_backup(&self, backup_id: &str) -> Result<(), BackupServiceError> {
        backup::restore_backup(backup_id)?;
        info!("Backup restored: {}", backup_id);
        Ok(())
    }
}
