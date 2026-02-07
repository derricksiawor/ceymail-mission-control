//! Audit logging for tracking all administrative actions.
//!
//! Every security-sensitive operation (service control, user management, domain
//! changes, credential access, backup/restore, etc.) is recorded as a structured
//! JSON event in the audit log. This provides a tamper-evident trail for
//! compliance, forensics, and debugging.
//!
//! # Format
//!
//! Each line in the audit log is a complete JSON object (JSON Lines format),
//! making it easy to parse with standard tools like `jq`, ingest into log
//! aggregators, or process programmatically.
//!
//! # Rotation
//!
//! The [`FileAuditLogger`] automatically rotates the log file when it exceeds
//! 10 MB, renaming the current file with a timestamp suffix before starting
//! a new one.

use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info, warn};

/// Default path for the audit log file.
pub const AUDIT_LOG_PATH: &str = "/var/lib/ceymail-mc/audit.log";

/// Maximum audit log file size before rotation (10 MB).
const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024;

/// Errors that can occur during audit operations.
#[derive(Debug, Error)]
pub enum AuditError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Audit logger lock poisoned")]
    LockPoisoned,
}

/// Administrative actions tracked by the audit system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    /// Start, stop, restart, or reload a system service.
    ServiceControl,
    /// Modify a configuration file.
    ConfigChange,
    /// Create a mail user account.
    UserCreate,
    /// Delete a mail user account.
    UserDelete,
    /// Add a mail domain.
    DomainCreate,
    /// Remove a mail domain.
    DomainDelete,
    /// Create a mail alias.
    AliasCreate,
    /// Remove a mail alias.
    AliasDelete,
    /// Generate DKIM signing keys.
    DkimGenerate,
    /// Change a user password.
    PasswordChange,
    /// Create a backup archive.
    BackupCreate,
    /// Restore from a backup archive.
    BackupRestore,
    /// Execute an installation step.
    InstallStep,
    /// Fix file/directory permissions.
    PermissionFix,
    /// Administrative login.
    Login,
    /// Administrative logout.
    Logout,
}

impl fmt::Display for AuditAction {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Self::ServiceControl => "service_control",
            Self::ConfigChange => "config_change",
            Self::UserCreate => "user_create",
            Self::UserDelete => "user_delete",
            Self::DomainCreate => "domain_create",
            Self::DomainDelete => "domain_delete",
            Self::AliasCreate => "alias_create",
            Self::AliasDelete => "alias_delete",
            Self::DkimGenerate => "dkim_generate",
            Self::PasswordChange => "password_change",
            Self::BackupCreate => "backup_create",
            Self::BackupRestore => "backup_restore",
            Self::InstallStep => "install_step",
            Self::PermissionFix => "permission_fix",
            Self::Login => "login",
            Self::Logout => "logout",
        };
        write!(f, "{}", s)
    }
}

/// The outcome of an audited operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditResult {
    /// The operation completed successfully.
    Success,
    /// The operation failed.
    Failure,
}

impl fmt::Display for AuditResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Success => write!(f, "success"),
            Self::Failure => write!(f, "failure"),
        }
    }
}

/// A single audit event capturing an administrative action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    /// When the event occurred (UTC).
    pub timestamp: DateTime<Utc>,
    /// What action was performed.
    pub action: AuditAction,
    /// Who performed the action (username, UID, or "system").
    pub actor: String,
    /// The target of the action (e.g., domain name, username, service name).
    pub target: String,
    /// Whether the action succeeded or failed.
    pub result: AuditResult,
    /// Additional human-readable details about the event.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl AuditEvent {
    /// Create a new audit event with the current UTC timestamp.
    pub fn new(
        action: AuditAction,
        actor: impl Into<String>,
        target: impl Into<String>,
        result: AuditResult,
    ) -> Self {
        Self {
            timestamp: Utc::now(),
            action,
            actor: actor.into(),
            target: target.into(),
            result,
            details: None,
        }
    }

    /// Create a new audit event with additional details.
    pub fn with_details(
        action: AuditAction,
        actor: impl Into<String>,
        target: impl Into<String>,
        result: AuditResult,
        details: impl Into<String>,
    ) -> Self {
        Self {
            timestamp: Utc::now(),
            action,
            actor: actor.into(),
            target: target.into(),
            result,
            details: Some(details.into()),
        }
    }

    /// Convenience: create a success event.
    pub fn success(
        action: AuditAction,
        actor: impl Into<String>,
        target: impl Into<String>,
    ) -> Self {
        Self::new(action, actor, target, AuditResult::Success)
    }

    /// Convenience: create a failure event with an error message.
    pub fn failure(
        action: AuditAction,
        actor: impl Into<String>,
        target: impl Into<String>,
        error: impl fmt::Display,
    ) -> Self {
        Self::with_details(action, actor, target, AuditResult::Failure, error.to_string())
    }
}

impl fmt::Display for AuditEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "[{}] {} {} on {} ({})",
            self.timestamp.to_rfc3339(),
            self.actor,
            self.action,
            self.target,
            self.result,
        )?;
        if let Some(ref details) = self.details {
            write!(f, ": {}", details)?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// AuditLogger trait
// ---------------------------------------------------------------------------

/// Trait for audit log backends.
///
/// Implementations must be safe to call from multiple threads.
pub trait AuditLogger: Send + Sync {
    /// Record an audit event.
    ///
    /// Implementations should make a best effort to persist the event. If
    /// persistence fails, the error should be logged but NOT propagated to
    /// the caller -- audit logging must never block or fail the audited
    /// operation itself.
    fn log_event(&self, event: &AuditEvent);
}

// ---------------------------------------------------------------------------
// FileAuditLogger
// ---------------------------------------------------------------------------

/// Audit logger that writes JSON Lines to a file.
///
/// Thread-safe via an internal `Mutex`. Automatically rotates the log file
/// when it exceeds [`MAX_LOG_SIZE`] (10 MB).
pub struct FileAuditLogger {
    /// Path to the current audit log file.
    log_path: PathBuf,
    /// Mutex-protected file writer. `None` if the file could not be opened.
    writer: Mutex<Option<BufWriter<File>>>,
}

impl FileAuditLogger {
    /// Create a new `FileAuditLogger` writing to the given path.
    ///
    /// The file is opened in append mode. The parent directory is created if
    /// it does not exist.
    pub fn new(log_path: &Path) -> Result<Self, AuditError> {
        // Ensure parent directory exists.
        if let Some(parent) = log_path.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
                info!(path = %parent.display(), "Created audit log directory");
            }
        }

        let file = Self::open_log_file(log_path)?;
        let writer = BufWriter::new(file);

        Ok(Self {
            log_path: log_path.to_path_buf(),
            writer: Mutex::new(Some(writer)),
        })
    }

    /// Create a `FileAuditLogger` at the default path.
    pub fn default_path() -> Result<Self, AuditError> {
        Self::new(Path::new(AUDIT_LOG_PATH))
    }

    /// Rotate the log file if it exceeds the size limit.
    ///
    /// The current file is renamed to `<path>.<ISO8601-timestamp>` and a new
    /// file is opened. Returns `true` if rotation occurred.
    fn maybe_rotate(&self, guard: &mut Option<BufWriter<File>>) -> Result<bool, AuditError> {
        let metadata = match fs::metadata(&self.log_path) {
            Ok(m) => m,
            Err(_) => return Ok(false),
        };

        if metadata.len() < MAX_LOG_SIZE {
            return Ok(false);
        }

        // Flush and drop the current writer.
        if let Some(ref mut w) = guard {
            let _ = w.flush();
        }
        *guard = None;

        // Rename with timestamp suffix.
        let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
        let rotated_name = format!("{}.{}", self.log_path.display(), timestamp);
        let rotated_path = PathBuf::from(&rotated_name);

        fs::rename(&self.log_path, &rotated_path).map_err(|e| {
            error!(
                from = %self.log_path.display(),
                to = %rotated_path.display(),
                error = %e,
                "Failed to rotate audit log"
            );
            e
        })?;

        info!(
            old = %rotated_path.display(),
            new = %self.log_path.display(),
            "Rotated audit log"
        );

        // Open a fresh log file.
        let file = Self::open_log_file(&self.log_path)?;
        *guard = Some(BufWriter::new(file));

        Ok(true)
    }

    /// Open (or create) the log file in append mode.
    fn open_log_file(path: &Path) -> Result<File, AuditError> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        Ok(file)
    }

    /// Write a single JSON event line to the log.
    fn write_event(
        writer: &mut BufWriter<File>,
        event: &AuditEvent,
    ) -> Result<(), AuditError> {
        let json = serde_json::to_string(event)?;
        writer.write_all(json.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()?;
        Ok(())
    }
}

impl AuditLogger for FileAuditLogger {
    fn log_event(&self, event: &AuditEvent) {
        let mut guard = match self.writer.lock() {
            Ok(g) => g,
            Err(poisoned) => {
                error!("Audit logger mutex poisoned, recovering");
                poisoned.into_inner()
            }
        };

        // Attempt rotation (best-effort).
        if let Err(e) = self.maybe_rotate(&mut guard) {
            warn!(error = %e, "Failed to check/rotate audit log");
        }

        // If writer is None (after a failed rotation or initial open), try to reopen.
        if guard.is_none() {
            match Self::open_log_file(&self.log_path) {
                Ok(file) => *guard = Some(BufWriter::new(file)),
                Err(e) => {
                    error!(
                        error = %e,
                        event = %event,
                        "Failed to open audit log, event lost"
                    );
                    return;
                }
            }
        }

        if let Some(ref mut writer) = *guard {
            if let Err(e) = Self::write_event(writer, event) {
                error!(
                    error = %e,
                    event = %event,
                    "Failed to write audit event"
                );
            }
        }
    }
}

impl fmt::Debug for FileAuditLogger {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FileAuditLogger")
            .field("log_path", &self.log_path)
            .finish()
    }
}

// ---------------------------------------------------------------------------
// NullAuditLogger (for testing or when audit is disabled)
// ---------------------------------------------------------------------------

/// An audit logger that discards all events.
///
/// Useful for testing or for environments where audit logging is explicitly
/// disabled.
#[derive(Debug, Clone)]
pub struct NullAuditLogger;

impl AuditLogger for NullAuditLogger {
    fn log_event(&self, _event: &AuditEvent) {
        // Intentionally empty.
    }
}

// ---------------------------------------------------------------------------
// InMemoryAuditLogger (for testing)
// ---------------------------------------------------------------------------

/// An audit logger that stores events in memory.
///
/// Useful for unit tests that need to verify audit events were emitted.
#[derive(Debug)]
pub struct InMemoryAuditLogger {
    events: Mutex<Vec<AuditEvent>>,
}

impl InMemoryAuditLogger {
    /// Create a new empty in-memory audit logger.
    pub fn new() -> Self {
        Self {
            events: Mutex::new(Vec::new()),
        }
    }

    /// Return a snapshot of all recorded events.
    pub fn events(&self) -> Vec<AuditEvent> {
        self.events
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Return the number of recorded events.
    pub fn len(&self) -> usize {
        self.events
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .len()
    }

    /// Check if no events have been recorded.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Clear all recorded events.
    pub fn clear(&self) {
        self.events
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
    }
}

impl Default for InMemoryAuditLogger {
    fn default() -> Self {
        Self::new()
    }
}

impl AuditLogger for InMemoryAuditLogger {
    fn log_event(&self, event: &AuditEvent) {
        self.events
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(event.clone());
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_audit_event_creation() {
        let event = AuditEvent::new(
            AuditAction::DomainCreate,
            "admin",
            "example.com",
            AuditResult::Success,
        );
        assert_eq!(event.action, AuditAction::DomainCreate);
        assert_eq!(event.actor, "admin");
        assert_eq!(event.target, "example.com");
        assert_eq!(event.result, AuditResult::Success);
        assert!(event.details.is_none());
    }

    #[test]
    fn test_audit_event_with_details() {
        let event = AuditEvent::with_details(
            AuditAction::ServiceControl,
            "root",
            "postfix",
            AuditResult::Failure,
            "Service failed to start: timeout",
        );
        assert_eq!(event.result, AuditResult::Failure);
        assert_eq!(event.details.as_deref(), Some("Service failed to start: timeout"));
    }

    #[test]
    fn test_audit_event_success_convenience() {
        let event = AuditEvent::success(AuditAction::UserCreate, "admin", "alice@example.com");
        assert_eq!(event.result, AuditResult::Success);
        assert!(event.details.is_none());
    }

    #[test]
    fn test_audit_event_failure_convenience() {
        let event = AuditEvent::failure(
            AuditAction::BackupCreate,
            "system",
            "/var/backup",
            "Disk full",
        );
        assert_eq!(event.result, AuditResult::Failure);
        assert_eq!(event.details.as_deref(), Some("Disk full"));
    }

    #[test]
    fn test_audit_event_display() {
        let event = AuditEvent::success(AuditAction::DkimGenerate, "admin", "example.com");
        let display = format!("{}", event);
        assert!(display.contains("admin"));
        assert!(display.contains("dkim_generate"));
        assert!(display.contains("example.com"));
        assert!(display.contains("success"));
    }

    #[test]
    fn test_audit_event_serialization_roundtrip() {
        let event = AuditEvent::with_details(
            AuditAction::PasswordChange,
            "admin",
            "user@example.com",
            AuditResult::Success,
            "Password updated via API",
        );

        let json = serde_json::to_string(&event).unwrap();
        let deserialized: AuditEvent = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.action, event.action);
        assert_eq!(deserialized.actor, event.actor);
        assert_eq!(deserialized.target, event.target);
        assert_eq!(deserialized.result, event.result);
        assert_eq!(deserialized.details, event.details);
    }

    #[test]
    fn test_audit_event_json_format() {
        let event = AuditEvent::new(
            AuditAction::Login,
            "admin",
            "web-ui",
            AuditResult::Success,
        );

        let json = serde_json::to_string(&event).unwrap();
        // Verify it parses as a valid JSON object.
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value.is_object());
        assert_eq!(value["action"], "login");
        assert_eq!(value["actor"], "admin");
        assert_eq!(value["target"], "web-ui");
        assert_eq!(value["result"], "success");
        // details should be absent when None, not null.
        assert!(!value.as_object().unwrap().contains_key("details"));
    }

    #[test]
    fn test_file_audit_logger_writes_json_lines() {
        let dir = TempDir::new().unwrap();
        let log_path = dir.path().join("audit.log");
        let logger = FileAuditLogger::new(&log_path).unwrap();

        logger.log_event(&AuditEvent::success(
            AuditAction::DomainCreate,
            "admin",
            "example.com",
        ));
        logger.log_event(&AuditEvent::success(
            AuditAction::UserCreate,
            "admin",
            "alice@example.com",
        ));
        logger.log_event(&AuditEvent::failure(
            AuditAction::ServiceControl,
            "system",
            "dovecot",
            "timeout",
        ));

        let content = fs::read_to_string(&log_path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 3);

        // Each line should be valid JSON.
        for line in &lines {
            let event: AuditEvent = serde_json::from_str(line).unwrap();
            assert!(!event.actor.is_empty());
        }

        // Verify specific events.
        let first: AuditEvent = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first.action, AuditAction::DomainCreate);
        assert_eq!(first.target, "example.com");

        let third: AuditEvent = serde_json::from_str(lines[2]).unwrap();
        assert_eq!(third.action, AuditAction::ServiceControl);
        assert_eq!(third.result, AuditResult::Failure);
        assert_eq!(third.details.as_deref(), Some("timeout"));
    }

    #[test]
    fn test_file_audit_logger_creates_parent_dirs() {
        let dir = TempDir::new().unwrap();
        let log_path = dir.path().join("nested").join("deep").join("audit.log");
        let logger = FileAuditLogger::new(&log_path).unwrap();

        logger.log_event(&AuditEvent::success(
            AuditAction::InstallStep,
            "system",
            "packages",
        ));

        assert!(log_path.exists());
    }

    #[test]
    fn test_file_audit_logger_appends() {
        let dir = TempDir::new().unwrap();
        let log_path = dir.path().join("audit.log");

        // Write one event, drop the logger.
        {
            let logger = FileAuditLogger::new(&log_path).unwrap();
            logger.log_event(&AuditEvent::success(
                AuditAction::Login,
                "admin",
                "web-ui",
            ));
        }

        // Open again and write another event.
        {
            let logger = FileAuditLogger::new(&log_path).unwrap();
            logger.log_event(&AuditEvent::success(
                AuditAction::Logout,
                "admin",
                "web-ui",
            ));
        }

        let content = fs::read_to_string(&log_path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);
    }

    #[test]
    fn test_file_audit_logger_rotation() {
        let dir = TempDir::new().unwrap();
        let log_path = dir.path().join("audit.log");

        let logger = FileAuditLogger::new(&log_path).unwrap();

        // Write enough data to exceed MAX_LOG_SIZE. Each JSON event is roughly
        // 200 bytes, so we need ~50,000 events for 10 MB. Use a large details
        // field to speed this up.
        let big_details = "x".repeat(10_000);
        let events_needed = (MAX_LOG_SIZE as usize / (big_details.len() + 200)) + 10;

        for _ in 0..events_needed {
            logger.log_event(&AuditEvent::with_details(
                AuditAction::ConfigChange,
                "test",
                "rotation-test",
                AuditResult::Success,
                &big_details,
            ));
        }

        // After rotation, the original path should still exist (new file)
        // and there should be a rotated file with a timestamp suffix.
        assert!(log_path.exists(), "Current log file should exist");

        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("audit.log.")
            })
            .collect();

        assert!(
            !entries.is_empty(),
            "At least one rotated log file should exist"
        );
    }

    #[test]
    fn test_in_memory_audit_logger() {
        let logger = InMemoryAuditLogger::new();
        assert!(logger.is_empty());

        logger.log_event(&AuditEvent::success(
            AuditAction::DomainCreate,
            "admin",
            "test.com",
        ));
        logger.log_event(&AuditEvent::success(
            AuditAction::UserCreate,
            "admin",
            "user@test.com",
        ));

        assert_eq!(logger.len(), 2);

        let events = logger.events();
        assert_eq!(events[0].action, AuditAction::DomainCreate);
        assert_eq!(events[1].action, AuditAction::UserCreate);

        logger.clear();
        assert!(logger.is_empty());
    }

    #[test]
    fn test_null_audit_logger() {
        let logger = NullAuditLogger;
        // Should not panic.
        logger.log_event(&AuditEvent::success(
            AuditAction::Login,
            "admin",
            "test",
        ));
    }

    #[test]
    fn test_audit_action_display() {
        assert_eq!(AuditAction::ServiceControl.to_string(), "service_control");
        assert_eq!(AuditAction::ConfigChange.to_string(), "config_change");
        assert_eq!(AuditAction::UserCreate.to_string(), "user_create");
        assert_eq!(AuditAction::UserDelete.to_string(), "user_delete");
        assert_eq!(AuditAction::DomainCreate.to_string(), "domain_create");
        assert_eq!(AuditAction::DomainDelete.to_string(), "domain_delete");
        assert_eq!(AuditAction::AliasCreate.to_string(), "alias_create");
        assert_eq!(AuditAction::AliasDelete.to_string(), "alias_delete");
        assert_eq!(AuditAction::DkimGenerate.to_string(), "dkim_generate");
        assert_eq!(AuditAction::PasswordChange.to_string(), "password_change");
        assert_eq!(AuditAction::BackupCreate.to_string(), "backup_create");
        assert_eq!(AuditAction::BackupRestore.to_string(), "backup_restore");
        assert_eq!(AuditAction::InstallStep.to_string(), "install_step");
        assert_eq!(AuditAction::PermissionFix.to_string(), "permission_fix");
        assert_eq!(AuditAction::Login.to_string(), "login");
        assert_eq!(AuditAction::Logout.to_string(), "logout");
    }

    #[test]
    fn test_all_audit_actions_serialize() {
        let actions = [
            AuditAction::ServiceControl,
            AuditAction::ConfigChange,
            AuditAction::UserCreate,
            AuditAction::UserDelete,
            AuditAction::DomainCreate,
            AuditAction::DomainDelete,
            AuditAction::AliasCreate,
            AuditAction::AliasDelete,
            AuditAction::DkimGenerate,
            AuditAction::PasswordChange,
            AuditAction::BackupCreate,
            AuditAction::BackupRestore,
            AuditAction::InstallStep,
            AuditAction::PermissionFix,
            AuditAction::Login,
            AuditAction::Logout,
        ];

        for action in &actions {
            let event = AuditEvent::success(*action, "test", "target");
            let json = serde_json::to_string(&event).unwrap();
            let roundtrip: AuditEvent = serde_json::from_str(&json).unwrap();
            assert_eq!(roundtrip.action, *action);
        }
    }
}
