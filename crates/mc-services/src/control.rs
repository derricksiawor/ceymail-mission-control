use mc_core::service::manager::{ServiceManager, ServiceStatus};
use thiserror::Error;
use tracing::info;

#[derive(Debug, Error)]
pub enum ControlError {
    #[error("Service error: {0}")]
    ServiceError(String),
    #[error("Service not found: {0}")]
    NotFound(String),
    #[error("Operation not permitted: {0}")]
    NotPermitted(String),
}

#[derive(Debug, Clone, Copy)]
pub enum ServiceAction {
    Start,
    Stop,
    Restart,
    Reload,
    Enable,
    Disable,
}

pub struct ControlService;

impl ControlService {
    pub fn new() -> Self {
        Self
    }

    /// Execute a service control action
    pub async fn control_service(
        &self,
        service_name: &str,
        action: ServiceAction,
    ) -> Result<ServiceStatus, ControlError> {
        let manager = ServiceManager::new()
            .map_err(|e| ControlError::ServiceError(e.to_string()))?;

        // Validate service name is in our whitelist
        if !ServiceManager::list_ceymail_services().contains(&service_name) {
            return Err(ControlError::NotFound(format!(
                "Service '{}' is not managed by CeyMail", service_name
            )));
        }

        match action {
            ServiceAction::Start => manager.start(service_name),
            ServiceAction::Stop => manager.stop(service_name),
            ServiceAction::Restart => manager.restart(service_name),
            ServiceAction::Reload => manager.reload(service_name),
            ServiceAction::Enable => manager.enable(service_name),
            ServiceAction::Disable => manager.disable(service_name),
        }
        .map_err(|e| ControlError::ServiceError(e.to_string()))?;

        info!("Service {} action {:?} completed", service_name, action);

        // Return updated status
        manager.status(service_name)
            .map_err(|e| ControlError::ServiceError(e.to_string()))
    }

    /// List all managed services with their status
    pub async fn list_services(&self) -> Result<Vec<ServiceStatus>, ControlError> {
        let manager = ServiceManager::new()
            .map_err(|e| ControlError::ServiceError(e.to_string()))?;
        let mut statuses = Vec::new();

        for service in ServiceManager::list_ceymail_services() {
            match manager.status(service) {
                Ok(status) => statuses.push(status),
                Err(_e) => {
                    statuses.push(ServiceStatus {
                        name: service.to_string(),
                        active_state: "unknown".to_string(),
                        sub_state: "unknown".to_string(),
                        pid: None,
                        memory_bytes: None,
                        uptime: None,
                    });
                }
            }
        }

        Ok(statuses)
    }

    /// Get status of a single service
    pub async fn get_service(&self, service_name: &str) -> Result<ServiceStatus, ControlError> {
        let manager = ServiceManager::new()
            .map_err(|e| ControlError::ServiceError(e.to_string()))?;

        if !ServiceManager::list_ceymail_services().contains(&service_name) {
            return Err(ControlError::NotFound(format!(
                "Service '{}' is not managed by CeyMail", service_name
            )));
        }

        manager.status(service_name)
            .map_err(|e| ControlError::ServiceError(e.to_string()))
    }
}
