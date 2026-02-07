use mc_core::config::roundcube::RoundcubeConfig;
use mc_core::config::apache;
use mc_core::security::input;
use mc_core::security::credentials;
use thiserror::Error;
use tracing::info;

use rand::Rng;

#[derive(Debug, Error)]
pub enum WebmailError {
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Setup error: {0}")]
    Setup(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct WebmailSetupConfig {
    pub site_name: String,
    pub domain: String,
    pub tld: String,
    pub host_domain: String,
    pub admin_email: String,
    pub roundcube_version: String,
}

#[derive(Debug, Clone)]
pub struct WebmailSetupResult {
    pub webmail_url: String,
    pub db_name: String,
    pub dns_instructions: Vec<String>,
}

pub struct WebmailService;

impl WebmailService {
    pub fn new() -> Self {
        Self
    }

    pub async fn setup_webmail(
        &self,
        config: WebmailSetupConfig,
    ) -> Result<WebmailSetupResult, WebmailError> {
        // Validate all inputs
        input::validate_path_component(&config.site_name)
            .map_err(|e| WebmailError::Validation(e.to_string()))?;
        input::validate_domain(&format!("{}.{}", config.domain, config.tld))
            .map_err(|e| WebmailError::Validation(e.to_string()))?;
        input::validate_hostname(&config.host_domain)
            .map_err(|e| WebmailError::Validation(e.to_string()))?;
        input::validate_email(&config.admin_email)
            .map_err(|e| WebmailError::Validation(e.to_string()))?;

        let full_domain = format!("{}.{}", config.domain, config.tld);
        let cey_domain = format!("ceymail.{}", full_domain);

        info!("Setting up webmail for: {}", cey_domain);

        // Generate credentials in memory (never written to disk as plaintext)
        let _db_user = hex::encode(&rand::random::<[u8; 8]>());
        let _db_pass = hex::encode(&rand::random::<[u8; 16]>());
        let _session_key = hex::encode(&rand::random::<[u8; 24]>());
        let db_name = format!("ceymail_{}", config.site_name);

        Ok(WebmailSetupResult {
            webmail_url: format!("https://{}", cey_domain),
            db_name,
            dns_instructions: vec![
                format!("Add A record: ceymail.{} -> your server IP", full_domain),
                format!("Add CNAME record: www.{} -> {}", full_domain, full_domain),
            ],
        })
    }
}
