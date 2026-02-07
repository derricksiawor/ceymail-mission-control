use mc_core::fs::permissions;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum PermissionServiceError {
    #[error("Permission error: {0}")]
    Permission(String),
}

pub struct PermissionService;

impl PermissionService {
    pub fn new() -> Self {
        Self
    }

    /// Fix all permissions according to the manifest
    pub async fn fix_all_permissions(&self) -> Result<Vec<String>, PermissionServiceError> {
        let errors = permissions::apply_all_permissions();

        let error_messages: Vec<String> = errors
            .iter()
            .map(|e| e.to_string())
            .collect();

        if error_messages.is_empty() {
            info!("All permissions fixed successfully");
        } else {
            info!("Permissions fixed with {} errors", error_messages.len());
        }

        Ok(error_messages)
    }

    /// Get the permission manifest for display
    pub fn get_manifest(&self) -> Vec<permissions::PermissionRule> {
        permissions::default_manifest()
    }
}
