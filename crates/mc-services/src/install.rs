use thiserror::Error;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{info, error};

use mc_core::install::orchestrator::{
    InstallConfig, InstallOrchestrator, StepState, StepStatus,
};

#[derive(Debug, Error)]
pub enum InstallError {
    #[error("Install error: {0}")]
    General(String),
    #[error("Step failed: {step} - {message}")]
    StepFailed { step: String, message: String },
    #[error("Already installed")]
    AlreadyInstalled,
}

/// Serializable progress update sent to gRPC streaming clients.
#[derive(Debug, Clone)]
pub struct InstallProgress {
    pub step_name: String,
    pub step_label: String,
    pub status: String,
    pub progress_percent: u8,
    pub message: String,
    pub step_index: usize,
    pub total_steps: usize,
}

impl InstallProgress {
    fn from_step_state(state: &StepState, index: usize, total: usize) -> Self {
        let status = match &state.status {
            StepStatus::Pending => "pending".to_string(),
            StepStatus::InProgress => "in_progress".to_string(),
            StepStatus::Completed => "completed".to_string(),
            StepStatus::Failed(msg) => format!("failed: {}", msg),
        };

        Self {
            step_name: state.name.clone(),
            step_label: state.label.clone(),
            status,
            progress_percent: state.progress_percent,
            message: state.message.clone(),
            step_index: index,
            total_steps: total,
        }
    }
}

pub struct InstallService;

impl InstallService {
    pub fn new() -> Self {
        Self
    }

    /// Start a full installation, returning a stream of progress updates.
    ///
    /// The returned `ReceiverStream` yields `InstallProgress` messages as each
    /// step transitions through Pending -> InProgress -> Completed/Failed.
    pub async fn start_install(
        &self,
        config: InstallConfig,
    ) -> Result<ReceiverStream<InstallProgress>, InstallError> {
        let (tx, rx) = mpsc::channel(64);

        tokio::spawn(async move {
            let mut orchestrator = InstallOrchestrator::new(config);
            let total = orchestrator.get_steps().len();
            let tx_clone = tx.clone();

            let result = orchestrator
                .run_all(|step_state| {
                    // Find the index of this step
                    let idx = orchestrator_step_index(&step_state.name);
                    let progress = InstallProgress::from_step_state(step_state, idx, total);
                    // Use try_send to avoid blocking the orchestrator
                    let _ = tx_clone.try_send(progress);
                })
                .await;

            if let Err(e) = result {
                error!(error = %e, "Installation failed");
                let _ = tx.try_send(InstallProgress {
                    step_name: "error".to_string(),
                    step_label: "Error".to_string(),
                    status: format!("failed: {}", e),
                    progress_percent: 0,
                    message: e.to_string(),
                    step_index: 0,
                    total_steps: total,
                });
            } else {
                info!("Installation completed successfully");
            }
        });

        Ok(ReceiverStream::new(rx))
    }

    /// Resume an installation from the last completed step.
    ///
    /// Inspects the orchestrator state and skips already-completed steps.
    pub async fn resume_install(
        &self,
        config: InstallConfig,
        completed_steps: Vec<String>,
    ) -> Result<ReceiverStream<InstallProgress>, InstallError> {
        let (tx, rx) = mpsc::channel(64);

        tokio::spawn(async move {
            let mut orchestrator = InstallOrchestrator::new(config);
            let total = orchestrator.get_steps().len();

            // Find the first non-completed step
            let start_from = completed_steps.len();

            let tx_ref = &tx;
            for i in start_from..total {
                match orchestrator.run_step(i).await {
                    Ok(step_state) => {
                        let progress =
                            InstallProgress::from_step_state(step_state, i, total);
                        let _ = tx_ref.try_send(progress);
                    }
                    Err(e) => {
                        error!(step_index = i, error = %e, "Step failed during resume");
                        let _ = tx_ref.try_send(InstallProgress {
                            step_name: format!("step_{}", i),
                            step_label: "Error".to_string(),
                            status: format!("failed: {}", e),
                            progress_percent: 0,
                            message: e.to_string(),
                            step_index: i,
                            total_steps: total,
                        });
                        break;
                    }
                }
            }

            info!("Resume installation completed");
        });

        Ok(ReceiverStream::new(rx))
    }

    /// Get the current state of all installation steps.
    ///
    /// Returns a snapshot of step states (useful for UI to render the wizard
    /// on reconnect or page refresh).
    pub fn get_install_state(
        &self,
        config: &InstallConfig,
    ) -> Vec<InstallProgress> {
        let orchestrator = InstallOrchestrator::new(config.clone());
        let total = orchestrator.get_steps().len();

        orchestrator
            .get_steps()
            .iter()
            .enumerate()
            .map(|(i, state)| InstallProgress::from_step_state(state, i, total))
            .collect()
    }
}

/// Map step name to its index in the orchestrator's step list.
fn orchestrator_step_index(name: &str) -> usize {
    match name {
        "system_check" => 0,
        "php_install" => 1,
        "core_packages" => 2,
        "domain_config" => 3,
        "database_setup" => 4,
        "ssl_certificates" => 5,
        "service_config" => 6,
        "dkim_setup" => 7,
        "permissions" => 8,
        "enable_services" => 9,
        "admin_account" => 10,
        "summary" => 11,
        _ => 0,
    }
}
