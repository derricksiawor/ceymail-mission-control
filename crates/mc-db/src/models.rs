use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// ============================================================
// Mail database models (existing ceymail schema)
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct VirtualDomain {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct VirtualUser {
    pub id: i64,
    pub domain_id: i64,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct VirtualAlias {
    pub id: i64,
    pub domain_id: i64,
    pub source: String,
    pub destination: String,
}

// ============================================================
// Dashboard database models (new ceymail_dashboard schema)
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditLog {
    pub id: i64,
    pub timestamp: DateTime<Utc>,
    pub action: String,
    pub actor: String,
    pub target: String,
    pub success: bool,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct HealthSnapshot {
    pub id: i64,
    pub timestamp: DateTime<Utc>,
    pub cpu_percent: f64,
    pub memory_used_bytes: i64,
    pub disk_used_bytes: i64,
    pub mail_queue_size: i32,
    pub services_healthy: i32,
    pub services_total: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InstallState {
    pub id: i64,
    pub step: String,
    pub status: String,
    pub progress_percent: i32,
    pub message: Option<String>,
    pub error_detail: Option<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DashboardUser {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub email: String,
    pub role: String,
    pub created_at: DateTime<Utc>,
    pub last_login: Option<DateTime<Utc>>,
}
