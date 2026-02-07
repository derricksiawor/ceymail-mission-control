use std::process::Command;
use thiserror::Error;
use tracing::{debug, info, warn};

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error("Service not in whitelist: {0}")]
    NotWhitelisted(String),
    #[error("systemctl command failed: {0}")]
    CommandFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to parse service status: {0}")]
    ParseError(String),
}

/// Status information for a systemd service
#[derive(Debug, Clone)]
pub struct ServiceStatus {
    pub name: String,
    pub active_state: String,
    pub sub_state: String,
    pub pid: Option<u32>,
    pub memory_bytes: Option<u64>,
    pub uptime: Option<String>,
}

/// Whitelist of CeyMail-managed services. Only these services can be controlled
/// through the ServiceManager to prevent arbitrary service manipulation.
const CEYMAIL_SERVICES: &[&str] = &[
    "postfix",
    "dovecot",
    "opendkim",
    "spamassassin",
    "apache2",
    "mariadb",
    "mysql",
    "unbound",
    "clamav-daemon",
    "clamav-freshclam",
    "fail2ban",
    "ceymail-mc",
];

/// Systemd service manager using systemctl commands.
///
/// Uses `std::process::Command` with proper argument passing (never shell
/// interpolation). Includes a whitelist of allowed service names to prevent
/// arbitrary service manipulation.
pub struct ServiceManager;

impl ServiceManager {
    /// Create a new ServiceManager instance
    pub fn new() -> Result<Self, ServiceError> {
        Ok(ServiceManager)
    }

    /// Return the list of CeyMail-managed services
    pub fn list_ceymail_services() -> Vec<&'static str> {
        CEYMAIL_SERVICES.to_vec()
    }

    /// Start a service
    pub fn start(&self, service: &str) -> Result<(), ServiceError> {
        self.check_whitelist(service)?;
        self.run_systemctl("start", service)?;
        info!("Started service: {}", service);
        Ok(())
    }

    /// Stop a service
    pub fn stop(&self, service: &str) -> Result<(), ServiceError> {
        self.check_whitelist(service)?;
        self.run_systemctl("stop", service)?;
        info!("Stopped service: {}", service);
        Ok(())
    }

    /// Restart a service
    pub fn restart(&self, service: &str) -> Result<(), ServiceError> {
        self.check_whitelist(service)?;
        self.run_systemctl("restart", service)?;
        info!("Restarted service: {}", service);
        Ok(())
    }

    /// Reload a service configuration
    pub fn reload(&self, service: &str) -> Result<(), ServiceError> {
        self.check_whitelist(service)?;
        self.run_systemctl("reload", service)?;
        info!("Reloaded service: {}", service);
        Ok(())
    }

    /// Enable a service to start at boot
    pub fn enable(&self, service: &str) -> Result<(), ServiceError> {
        self.check_whitelist(service)?;
        self.run_systemctl("enable", service)?;
        info!("Enabled service: {}", service);
        Ok(())
    }

    /// Disable a service from starting at boot
    pub fn disable(&self, service: &str) -> Result<(), ServiceError> {
        self.check_whitelist(service)?;
        self.run_systemctl("disable", service)?;
        info!("Disabled service: {}", service);
        Ok(())
    }

    /// Check if a service is currently active
    pub fn is_active(&self, service: &str) -> Result<bool, ServiceError> {
        self.check_whitelist(service)?;
        let output = Command::new("systemctl")
            .arg("is-active")
            .arg(service)
            .output()?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(stdout == "active")
    }

    /// Get detailed status of a service
    pub fn status(&self, service: &str) -> Result<ServiceStatus, ServiceError> {
        self.check_whitelist(service)?;

        let active_state = self.get_property(service, "ActiveState")?;
        let sub_state = self.get_property(service, "SubState")?;

        let pid = self.get_property(service, "MainPID")
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .filter(|&pid| pid > 0);

        let memory_bytes = self.get_property(service, "MemoryCurrent")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|&mem| mem < u64::MAX); // [not set] parses as max

        let uptime = self.get_property(service, "ActiveEnterTimestamp")
            .ok()
            .filter(|s| !s.is_empty() && s != "n/a");

        Ok(ServiceStatus {
            name: service.to_string(),
            active_state,
            sub_state,
            pid,
            memory_bytes,
            uptime,
        })
    }

    /// Verify that a service name is in the whitelist
    fn check_whitelist(&self, service: &str) -> Result<(), ServiceError> {
        if !CEYMAIL_SERVICES.contains(&service) {
            return Err(ServiceError::NotWhitelisted(service.to_string()));
        }
        Ok(())
    }

    /// Run a systemctl action on a service
    fn run_systemctl(&self, action: &str, service: &str) -> Result<(), ServiceError> {
        debug!("Running: systemctl {} {}", action, service);

        let output = Command::new("systemctl")
            .arg(action)
            .arg(service)
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(ServiceError::CommandFailed(format!(
                "systemctl {} {} failed: {}",
                action, service, stderr
            )));
        }

        Ok(())
    }

    /// Get a single systemd property for a service using `systemctl show`
    fn get_property(&self, service: &str, property: &str) -> Result<String, ServiceError> {
        let output = Command::new("systemctl")
            .arg("show")
            .arg(service)
            .arg(format!("--property={}", property))
            .arg("--value")
            .output()?;

        if !output.status.success() {
            return Err(ServiceError::ParseError(format!(
                "Failed to get property {} for {}",
                property, service
            )));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
}

impl Default for ServiceManager {
    fn default() -> Self {
        ServiceManager
    }
}
