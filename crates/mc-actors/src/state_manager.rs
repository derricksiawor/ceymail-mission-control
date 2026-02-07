use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::info;

use crate::log_watcher::LogEntry;
use crate::stats_collector::SystemSnapshot;
use crate::queue_monitor::QueueSnapshot;

/// Service status for a single CeyMail-managed service
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceState {
    pub name: String,
    pub active: bool,
    pub status: String,
    pub pid: Option<u32>,
    pub memory_bytes: Option<u64>,
    pub uptime_seconds: Option<u64>,
}

/// The complete aggregated state of the CeyMail system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregatedState {
    pub services: Vec<ServiceState>,
    pub latest_stats: Option<SystemSnapshot>,
    pub latest_queue: Option<QueueSnapshot>,
    pub recent_logs: Vec<LogEntry>,
    pub last_updated: chrono::DateTime<Utc>,
}

impl Default for AggregatedState {
    fn default() -> Self {
        Self {
            services: Vec::new(),
            latest_stats: None,
            latest_queue: None,
            recent_logs: Vec::new(),
            last_updated: Utc::now(),
        }
    }
}

/// Central state manager that aggregates data from all actors
pub struct StateManager {
    state: Arc<RwLock<AggregatedState>>,
    change_sender: broadcast::Sender<AggregatedState>,
}

impl StateManager {
    pub fn new() -> Self {
        let (change_sender, _) = broadcast::channel(16);
        Self {
            state: Arc::new(RwLock::new(AggregatedState::default())),
            change_sender,
        }
    }

    /// Get a snapshot of the current state
    pub async fn get_state(&self) -> AggregatedState {
        self.state.read().await.clone()
    }

    /// Subscribe to state changes
    pub fn subscribe(&self) -> broadcast::Receiver<AggregatedState> {
        self.change_sender.subscribe()
    }

    /// Update system stats
    pub async fn update_stats(&self, snapshot: SystemSnapshot) {
        let mut state = self.state.write().await;
        state.latest_stats = Some(snapshot);
        state.last_updated = Utc::now();
        let _ = self.change_sender.send(state.clone());
    }

    /// Update queue stats
    pub async fn update_queue(&self, snapshot: QueueSnapshot) {
        let mut state = self.state.write().await;
        state.latest_queue = Some(snapshot);
        state.last_updated = Utc::now();
        let _ = self.change_sender.send(state.clone());
    }

    /// Add a log entry (keeps last 1000)
    pub async fn add_log(&self, entry: LogEntry) {
        let mut state = self.state.write().await;
        state.recent_logs.push(entry);
        if state.recent_logs.len() > 1000 {
            let excess = state.recent_logs.len() - 1000;
            state.recent_logs.drain(..excess);
        }
        state.last_updated = Utc::now();
        // Don't broadcast on every log entry - too noisy
    }

    /// Update service states
    pub async fn update_services(&self, services: Vec<ServiceState>) {
        let mut state = self.state.write().await;
        state.services = services;
        state.last_updated = Utc::now();
        let _ = self.change_sender.send(state.clone());
    }

    /// Get a reference to the shared state for passing to other components
    pub fn shared_state(&self) -> Arc<RwLock<AggregatedState>> {
        self.state.clone()
    }
}
