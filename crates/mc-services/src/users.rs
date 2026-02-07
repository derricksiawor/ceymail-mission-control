use mc_core::mail::password;
use mc_core::security::input;
use mc_db::pool::DbError;
use mc_db::queries;
use sqlx::MySqlPool;
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum UserError {
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Database error: {0}")]
    Database(#[from] DbError),
    #[error("Password error: {0}")]
    Password(String),
    #[error("Not found: {0}")]
    NotFound(String),
}

pub struct UserService {
    pool: MySqlPool,
}

impl UserService {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    // --- Domains ---

    pub async fn create_domain(&self, name: &str) -> Result<i64, UserError> {
        // Validate domain name strictly
        input::validate_domain(name)
            .map_err(|e| UserError::Validation(e.to_string()))?;

        let id = queries::create_domain(&self.pool, name).await?;
        info!("Created domain: {} (id: {})", name, id);
        Ok(id)
    }

    pub async fn list_domains(&self) -> Result<Vec<mc_db::models::VirtualDomain>, UserError> {
        Ok(queries::list_domains(&self.pool).await?)
    }

    pub async fn delete_domain(&self, id: i64) -> Result<(), UserError> {
        queries::delete_domain(&self.pool, id).await?;
        info!("Deleted domain id: {}", id);
        Ok(())
    }

    // --- Users ---

    pub async fn create_user(
        &self,
        domain_id: i64,
        email: &str,
        plaintext_password: &str,
    ) -> Result<i64, UserError> {
        // Validate email
        input::validate_email(email)
            .map_err(|e| UserError::Validation(e.to_string()))?;

        // Validate password strength
        input::validate_password(plaintext_password)
            .map_err(|e| UserError::Validation(e.to_string()))?;

        // Hash password using SHA512-CRYPT (Dovecot compatible)
        let hash = password::hash_password(plaintext_password)
            .map_err(|e| UserError::Password(e.to_string()))?;

        let id = queries::create_user(&self.pool, domain_id, email, &hash).await?;
        info!("Created user: {} (id: {})", email, id);
        Ok(id)
    }

    pub async fn list_users(&self) -> Result<Vec<mc_db::models::VirtualUser>, UserError> {
        Ok(queries::list_users(&self.pool).await?)
    }

    pub async fn list_users_by_domain(
        &self,
        domain_id: i64,
    ) -> Result<Vec<mc_db::models::VirtualUser>, UserError> {
        Ok(queries::list_users_by_domain(&self.pool, domain_id).await?)
    }

    pub async fn change_password(
        &self,
        user_id: i64,
        new_password: &str,
    ) -> Result<(), UserError> {
        // Validate password strength
        input::validate_password(new_password)
            .map_err(|e| UserError::Validation(e.to_string()))?;

        let hash = password::hash_password(new_password)
            .map_err(|e| UserError::Password(e.to_string()))?;

        queries::update_user_password(&self.pool, user_id, &hash).await?;
        info!("Changed password for user id: {}", user_id);
        Ok(())
    }

    pub async fn delete_user(&self, id: i64) -> Result<(), UserError> {
        queries::delete_user(&self.pool, id).await?;
        info!("Deleted user id: {}", id);
        Ok(())
    }

    // --- Aliases ---

    pub async fn create_alias(
        &self,
        domain_id: i64,
        source: &str,
        destination: &str,
    ) -> Result<i64, UserError> {
        // Validate both email addresses
        input::validate_email(source)
            .map_err(|e| UserError::Validation(format!("Source: {}", e)))?;
        input::validate_email(destination)
            .map_err(|e| UserError::Validation(format!("Destination: {}", e)))?;

        let id = queries::create_alias(&self.pool, domain_id, source, destination).await?;
        info!("Created alias: {} -> {} (id: {})", source, destination, id);
        Ok(id)
    }

    pub async fn list_aliases(&self) -> Result<Vec<mc_db::models::VirtualAlias>, UserError> {
        Ok(queries::list_aliases(&self.pool).await?)
    }

    pub async fn list_aliases_by_domain(
        &self,
        domain_id: i64,
    ) -> Result<Vec<mc_db::models::VirtualAlias>, UserError> {
        Ok(queries::list_aliases_by_domain(&self.pool, domain_id).await?)
    }

    pub async fn delete_alias(&self, id: i64) -> Result<(), UserError> {
        queries::delete_alias(&self.pool, id).await?;
        info!("Deleted alias id: {}", id);
        Ok(())
    }
}
