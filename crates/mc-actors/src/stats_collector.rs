use chrono::Utc;
use serde::{Deserialize, Serialize};
use sysinfo::System;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tracing::{debug, error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemSnapshot {
    pub timestamp: chrono::DateTime<Utc>,
    pub cpu: CpuStats,
    pub memory: MemoryStats,
    pub disks: Vec<DiskStats>,
    pub load_avg: LoadAverage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuStats {
    pub usage_percent: f32,
    pub per_core: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStats {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskStats {
    pub mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadAverage {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

pub struct StatsCollector {
    sender: broadcast::Sender<SystemSnapshot>,
    handle: Option<JoinHandle<()>>,
}

impl StatsCollector {
    pub fn new(buffer_size: usize) -> (Self, broadcast::Receiver<SystemSnapshot>) {
        let (sender, receiver) = broadcast::channel(buffer_size);
        (
            Self {
                sender,
                handle: None,
            },
            receiver,
        )
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SystemSnapshot> {
        self.sender.subscribe()
    }

    /// Start collecting stats at the given interval
    pub fn start(&mut self, interval: Duration) {
        let sender = self.sender.clone();

        let handle = tokio::spawn(async move {
            let mut sys = System::new_all();

            loop {
                sys.refresh_all();

                let snapshot = collect_snapshot(&sys);
                let _ = sender.send(snapshot);

                tokio::time::sleep(interval).await;
            }
        });

        self.handle = Some(handle);
        info!("Stats collector started with {:?} interval", interval);
    }

    pub fn stop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            info!("Stats collector stopped");
        }
    }

    /// Collect a single snapshot (for one-off queries)
    pub fn collect_once() -> SystemSnapshot {
        let mut sys = System::new_all();
        sys.refresh_all();
        // Need a brief sleep for CPU measurements to be accurate
        std::thread::sleep(Duration::from_millis(200));
        sys.refresh_cpu_all();
        collect_snapshot(&sys)
    }
}

fn collect_snapshot(sys: &System) -> SystemSnapshot {
    let cpu = CpuStats {
        usage_percent: sys.global_cpu_usage(),
        per_core: sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
    };

    let memory = MemoryStats {
        total_bytes: sys.total_memory(),
        used_bytes: sys.used_memory(),
        available_bytes: sys.available_memory(),
        swap_total_bytes: sys.total_swap(),
        swap_used_bytes: sys.used_swap(),
    };

    let disks: Vec<DiskStats> = sysinfo::Disks::new_with_refreshed_list()
        .iter()
        .map(|d| DiskStats {
            mount_point: d.mount_point().to_string_lossy().to_string(),
            total_bytes: d.total_space(),
            used_bytes: d.total_space() - d.available_space(),
            available_bytes: d.available_space(),
        })
        .collect();

    let load_avg = System::load_average();

    SystemSnapshot {
        timestamp: Utc::now(),
        cpu,
        memory,
        disks,
        load_avg: LoadAverage {
            one: load_avg.one,
            five: load_avg.five,
            fifteen: load_avg.fifteen,
        },
    }
}
