use crate::models::*;
use crate::pool::DbError;
use sqlx::MySqlPool;
use tracing::debug;

// ============================================================
// Virtual Domains (mail database)
// ============================================================

pub async fn create_domain(pool: &MySqlPool, name: &str) -> Result<i64, DbError> {
    let result = sqlx::query("INSERT INTO virtual_domains (name) VALUES (?)")
        .bind(name)
        .execute(pool)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(ref db_err) = e {
                if db_err.code().as_deref() == Some("23000") {
                    return DbError::Duplicate(format!("Domain already exists: {}", name));
                }
            }
            DbError::Connection(e)
        })?;

    debug!("Created domain: {}", name);
    Ok(result.last_insert_id() as i64)
}

pub async fn list_domains(pool: &MySqlPool) -> Result<Vec<VirtualDomain>, DbError> {
    let domains = sqlx::query_as::<_, VirtualDomain>(
        "SELECT id, name FROM virtual_domains ORDER BY name"
    )
    .fetch_all(pool)
    .await?;
    Ok(domains)
}

pub async fn get_domain(pool: &MySqlPool, id: i64) -> Result<VirtualDomain, DbError> {
    sqlx::query_as::<_, VirtualDomain>(
        "SELECT id, name FROM virtual_domains WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| DbError::NotFound(format!("Domain with id {}", id)))
}

pub async fn get_domain_by_name(pool: &MySqlPool, name: &str) -> Result<VirtualDomain, DbError> {
    sqlx::query_as::<_, VirtualDomain>(
        "SELECT id, name FROM virtual_domains WHERE name = ?"
    )
    .bind(name)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| DbError::NotFound(format!("Domain: {}", name)))
}

pub async fn delete_domain(pool: &MySqlPool, id: i64) -> Result<(), DbError> {
    // Delete associated users and aliases first (cascading)
    sqlx::query("DELETE FROM virtual_aliases WHERE domain_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    sqlx::query("DELETE FROM virtual_users WHERE domain_id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    let result = sqlx::query("DELETE FROM virtual_domains WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("Domain with id {}", id)));
    }

    debug!("Deleted domain id: {}", id);
    Ok(())
}

// ============================================================
// Virtual Users (mail database)
// ============================================================

pub async fn create_user(
    pool: &MySqlPool,
    domain_id: i64,
    email: &str,
    password_hash: &str,
) -> Result<i64, DbError> {
    let result = sqlx::query(
        "INSERT INTO virtual_users (domain_id, email, password) VALUES (?, ?, ?)"
    )
    .bind(domain_id)
    .bind(email)
    .bind(password_hash)
    .execute(pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.code().as_deref() == Some("23000") {
                return DbError::Duplicate(format!("User already exists: {}", email));
            }
        }
        DbError::Connection(e)
    })?;

    debug!("Created user: {}", email);
    Ok(result.last_insert_id() as i64)
}

pub async fn list_users(pool: &MySqlPool) -> Result<Vec<VirtualUser>, DbError> {
    let users = sqlx::query_as::<_, VirtualUser>(
        "SELECT id, domain_id, email, password FROM virtual_users ORDER BY email"
    )
    .fetch_all(pool)
    .await?;
    Ok(users)
}

pub async fn list_users_by_domain(pool: &MySqlPool, domain_id: i64) -> Result<Vec<VirtualUser>, DbError> {
    let users = sqlx::query_as::<_, VirtualUser>(
        "SELECT id, domain_id, email, password FROM virtual_users WHERE domain_id = ? ORDER BY email"
    )
    .bind(domain_id)
    .fetch_all(pool)
    .await?;
    Ok(users)
}

pub async fn get_user(pool: &MySqlPool, id: i64) -> Result<VirtualUser, DbError> {
    sqlx::query_as::<_, VirtualUser>(
        "SELECT id, domain_id, email, password FROM virtual_users WHERE id = ?"
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| DbError::NotFound(format!("User with id {}", id)))
}

pub async fn update_user_password(
    pool: &MySqlPool,
    id: i64,
    password_hash: &str,
) -> Result<(), DbError> {
    let result = sqlx::query("UPDATE virtual_users SET password = ? WHERE id = ?")
        .bind(password_hash)
        .bind(id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("User with id {}", id)));
    }
    Ok(())
}

pub async fn delete_user(pool: &MySqlPool, id: i64) -> Result<(), DbError> {
    let result = sqlx::query("DELETE FROM virtual_users WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("User with id {}", id)));
    }

    debug!("Deleted user id: {}", id);
    Ok(())
}

// ============================================================
// Virtual Aliases (mail database)
// ============================================================

pub async fn create_alias(
    pool: &MySqlPool,
    domain_id: i64,
    source: &str,
    destination: &str,
) -> Result<i64, DbError> {
    let result = sqlx::query(
        "INSERT INTO virtual_aliases (domain_id, source, destination) VALUES (?, ?, ?)"
    )
    .bind(domain_id)
    .bind(source)
    .bind(destination)
    .execute(pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.code().as_deref() == Some("23000") {
                return DbError::Duplicate(format!("Alias already exists: {} -> {}", source, destination));
            }
        }
        DbError::Connection(e)
    })?;

    debug!("Created alias: {} -> {}", source, destination);
    Ok(result.last_insert_id() as i64)
}

pub async fn list_aliases(pool: &MySqlPool) -> Result<Vec<VirtualAlias>, DbError> {
    let aliases = sqlx::query_as::<_, VirtualAlias>(
        "SELECT id, domain_id, source, destination FROM virtual_aliases ORDER BY source"
    )
    .fetch_all(pool)
    .await?;
    Ok(aliases)
}

pub async fn list_aliases_by_domain(pool: &MySqlPool, domain_id: i64) -> Result<Vec<VirtualAlias>, DbError> {
    let aliases = sqlx::query_as::<_, VirtualAlias>(
        "SELECT id, domain_id, source, destination FROM virtual_aliases WHERE domain_id = ? ORDER BY source"
    )
    .bind(domain_id)
    .fetch_all(pool)
    .await?;
    Ok(aliases)
}

pub async fn delete_alias(pool: &MySqlPool, id: i64) -> Result<(), DbError> {
    let result = sqlx::query("DELETE FROM virtual_aliases WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;

    if result.rows_affected() == 0 {
        return Err(DbError::NotFound(format!("Alias with id {}", id)));
    }

    debug!("Deleted alias id: {}", id);
    Ok(())
}

// ============================================================
// Dashboard database queries
// ============================================================

pub async fn log_audit_event(
    pool: &MySqlPool,
    action: &str,
    actor: &str,
    target: &str,
    success: bool,
    details: Option<&str>,
) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO audit_logs (timestamp, action, actor, target, success, details) VALUES (NOW(), ?, ?, ?, ?, ?)"
    )
    .bind(action)
    .bind(actor)
    .bind(target)
    .bind(success)
    .bind(details)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn save_health_snapshot(
    pool: &MySqlPool,
    cpu_percent: f64,
    memory_used_bytes: i64,
    disk_used_bytes: i64,
    mail_queue_size: i32,
    services_healthy: i32,
    services_total: i32,
) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO health_snapshots (timestamp, cpu_percent, memory_used_bytes, disk_used_bytes, mail_queue_size, services_healthy, services_total) VALUES (NOW(), ?, ?, ?, ?, ?, ?)"
    )
    .bind(cpu_percent)
    .bind(memory_used_bytes)
    .bind(disk_used_bytes)
    .bind(mail_queue_size)
    .bind(services_healthy)
    .bind(services_total)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_recent_health_snapshots(
    pool: &MySqlPool,
    limit: i32,
) -> Result<Vec<HealthSnapshot>, DbError> {
    let snapshots = sqlx::query_as::<_, HealthSnapshot>(
        "SELECT id, timestamp, cpu_percent, memory_used_bytes, disk_used_bytes, mail_queue_size, services_healthy, services_total FROM health_snapshots ORDER BY timestamp DESC LIMIT ?"
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;
    Ok(snapshots)
}

pub async fn save_install_state(
    pool: &MySqlPool,
    step: &str,
    status: &str,
    progress_percent: i32,
    message: Option<&str>,
    error_detail: Option<&str>,
) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO install_state (step, status, progress_percent, message, error_detail, updated_at) VALUES (?, ?, ?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE status = VALUES(status), progress_percent = VALUES(progress_percent), message = VALUES(message), error_detail = VALUES(error_detail), updated_at = NOW()"
    )
    .bind(step)
    .bind(status)
    .bind(progress_percent)
    .bind(message)
    .bind(error_detail)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_install_state(pool: &MySqlPool) -> Result<Vec<InstallState>, DbError> {
    let states = sqlx::query_as::<_, InstallState>(
        "SELECT id, step, status, progress_percent, message, error_detail, updated_at FROM install_state ORDER BY id"
    )
    .fetch_all(pool)
    .await?;
    Ok(states)
}

pub async fn create_dashboard_user(
    pool: &MySqlPool,
    username: &str,
    password_hash: &str,
    email: &str,
    role: &str,
) -> Result<i64, DbError> {
    let result = sqlx::query(
        "INSERT INTO dashboard_users (username, password_hash, email, role, created_at) VALUES (?, ?, ?, ?, NOW())"
    )
    .bind(username)
    .bind(password_hash)
    .bind(email)
    .bind(role)
    .execute(pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(ref db_err) = e {
            if db_err.code().as_deref() == Some("23000") {
                return DbError::Duplicate(format!("Dashboard user already exists: {}", username));
            }
        }
        DbError::Connection(e)
    })?;
    Ok(result.last_insert_id() as i64)
}

pub async fn get_dashboard_user_by_username(
    pool: &MySqlPool,
    username: &str,
) -> Result<DashboardUser, DbError> {
    sqlx::query_as::<_, DashboardUser>(
        "SELECT id, username, password_hash, email, role, created_at, last_login FROM dashboard_users WHERE username = ?"
    )
    .bind(username)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| DbError::NotFound(format!("Dashboard user: {}", username)))
}

/// Database backup using mysqldump subprocess (credentials passed via environment, not CLI args)
pub async fn dump_database(database_name: &str, output_path: &str, username: &str, password: &str) -> Result<(), DbError> {
    use std::process::Command;
    use std::fs::File;

    let output_file = File::create(output_path)
        .map_err(|e| DbError::Query(format!("Failed to create dump file: {}", e)))?;

    // Pass password via environment variable - NEVER as CLI arg (fixes ps visibility bug)
    let status = Command::new("mysqldump")
        .arg("--user")
        .arg(username)
        .arg("--single-transaction")
        .arg("--routines")
        .arg("--triggers")
        .arg(database_name)
        .env("MYSQL_PWD", password)
        .stdout(output_file)
        .status()
        .map_err(|e| DbError::Query(format!("mysqldump failed: {}", e)))?;

    if !status.success() {
        return Err(DbError::Query("mysqldump exited with non-zero status".into()));
    }

    Ok(())
}
