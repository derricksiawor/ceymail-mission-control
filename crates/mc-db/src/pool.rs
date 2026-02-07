use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("Database connection error: {0}")]
    Connection(#[from] sqlx::Error),
    #[error("Migration error: {0}")]
    Migration(String),
    #[error("Query error: {0}")]
    Query(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Duplicate entry: {0}")]
    Duplicate(String),
}

#[derive(Clone)]
pub struct Database {
    /// Pool for the ceymail_dashboard database (audit, health, install state, dashboard users)
    pub dashboard_pool: MySqlPool,
    /// Pool for the ceymail database (virtual_domains, virtual_users, virtual_aliases)
    pub mail_pool: MySqlPool,
}

impl Database {
    /// Connect to both databases using the provided credentials.
    /// Credentials come from the encrypted credential store - never from command line args.
    pub async fn connect(
        dashboard_url: &str,
        mail_url: &str,
    ) -> Result<Self, DbError> {
        let dashboard_pool = MySqlPoolOptions::new()
            .max_connections(10)
            .min_connections(2)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .idle_timeout(std::time::Duration::from_secs(300))
            .connect(dashboard_url)
            .await?;

        info!("Connected to ceymail_dashboard database");

        let mail_pool = MySqlPoolOptions::new()
            .max_connections(10)
            .min_connections(2)
            .acquire_timeout(std::time::Duration::from_secs(5))
            .idle_timeout(std::time::Duration::from_secs(300))
            .connect(mail_url)
            .await?;

        info!("Connected to ceymail mail database");

        Ok(Self {
            dashboard_pool,
            mail_pool,
        })
    }

    /// Connect with a single URL (for initial setup when mail DB may not exist yet)
    pub async fn connect_dashboard_only(dashboard_url: &str) -> Result<MySqlPool, DbError> {
        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .connect(dashboard_url)
            .await?;
        Ok(pool)
    }

    /// Create the ceymail_dashboard database if it doesn't exist
    pub async fn ensure_dashboard_db(root_url: &str) -> Result<(), DbError> {
        let pool = MySqlPoolOptions::new()
            .max_connections(1)
            .connect(root_url)
            .await?;

        sqlx::query("CREATE DATABASE IF NOT EXISTS `ceymail_dashboard` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            .execute(&pool)
            .await?;

        info!("Ensured ceymail_dashboard database exists");
        Ok(())
    }

    /// Create the ceymail mail database if it doesn't exist
    pub async fn ensure_mail_db(root_url: &str) -> Result<(), DbError> {
        let pool = MySqlPoolOptions::new()
            .max_connections(1)
            .connect(root_url)
            .await?;

        sqlx::query("CREATE DATABASE IF NOT EXISTS `ceymail` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            .execute(&pool)
            .await?;

        info!("Ensured ceymail mail database exists");
        Ok(())
    }
}
