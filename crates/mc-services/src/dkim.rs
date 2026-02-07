use mc_core::config::opendkim::OpendkimConfig;
use mc_core::mail::dkim;
use mc_core::security::input;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum DkimServiceError {
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("DKIM error: {0}")]
    Dkim(#[from] dkim::DkimError),
    #[error("Config error: {0}")]
    Config(String),
}

pub struct DkimService;

impl DkimService {
    pub fn new() -> Self {
        Self
    }

    /// Generate DKIM keys for a domain and update OpenDKIM config
    pub async fn generate_dkim(
        &self,
        domain: &str,
        selector: &str,
    ) -> Result<dkim::DkimKeyInfo, DkimServiceError> {
        // Validate domain
        input::validate_domain(domain)
            .map_err(|e| DkimServiceError::Validation(e.to_string()))?;
        input::validate_path_component(selector)
            .map_err(|e| DkimServiceError::Validation(e.to_string()))?;

        // Generate key
        let key_info = dkim::generate_dkim_key(domain, selector)?;

        // Update OpenDKIM config files
        let mut config = OpendkimConfig::load()
            .map_err(|e| DkimServiceError::Config(e.to_string()))?;
        config.add_domain(domain, selector)
            .map_err(|e| DkimServiceError::Config(e.to_string()))?;
        config.save()
            .map_err(|e| DkimServiceError::Config(e.to_string()))?;

        info!("Generated DKIM for domain: {} selector: {}", domain, selector);
        Ok(key_info)
    }

    /// List all DKIM keys
    pub async fn list_keys(&self) -> Result<Vec<dkim::DkimKeyInfo>, DkimServiceError> {
        Ok(dkim::list_dkim_domains()?)
    }

    /// Delete DKIM key and update config
    pub async fn delete_key(&self, domain: &str) -> Result<(), DkimServiceError> {
        input::validate_domain(domain)
            .map_err(|e| DkimServiceError::Validation(e.to_string()))?;

        // Remove from config
        let mut config = OpendkimConfig::load()
            .map_err(|e| DkimServiceError::Config(e.to_string()))?;
        config.remove_domain(domain)
            .map_err(|e| DkimServiceError::Config(e.to_string()))?;
        config.save()
            .map_err(|e| DkimServiceError::Config(e.to_string()))?;

        // Delete key files
        dkim::delete_dkim_key(domain)?;

        info!("Deleted DKIM key for domain: {}", domain);
        Ok(())
    }
}
