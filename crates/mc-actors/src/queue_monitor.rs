use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QueueSnapshot {
    pub timestamp: chrono::DateTime<Utc>,
    pub active: u32,
    pub deferred: u32,
    pub hold: u32,
    pub bounce: u32,
    pub total: u32,
}

#[derive(Debug, Deserialize)]
struct PostqueueEntry {
    queue_name: Option<String>,
    queue_id: Option<String>,
    #[serde(default)]
    recipients: Vec<PostqueueRecipient>,
}

#[derive(Debug, Deserialize)]
struct PostqueueRecipient {
    address: Option<String>,
}

pub struct QueueMonitor {
    sender: broadcast::Sender<QueueSnapshot>,
    handle: Option<JoinHandle<()>>,
}

impl QueueMonitor {
    pub fn new(buffer_size: usize) -> (Self, broadcast::Receiver<QueueSnapshot>) {
        let (sender, receiver) = broadcast::channel(buffer_size);
        (
            Self {
                sender,
                handle: None,
            },
            receiver,
        )
    }

    pub fn subscribe(&self) -> broadcast::Receiver<QueueSnapshot> {
        self.sender.subscribe()
    }

    pub fn start(&mut self, interval: Duration) {
        let sender = self.sender.clone();

        let handle = tokio::spawn(async move {
            loop {
                let snapshot = collect_queue_stats();
                let _ = sender.send(snapshot);
                tokio::time::sleep(interval).await;
            }
        });

        self.handle = Some(handle);
        info!("Queue monitor started with {:?} interval", interval);
    }

    pub fn stop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            info!("Queue monitor stopped");
        }
    }

    /// One-off queue check
    pub fn check_once() -> QueueSnapshot {
        collect_queue_stats()
    }
}

fn collect_queue_stats() -> QueueSnapshot {
    let mut snapshot = QueueSnapshot {
        timestamp: Utc::now(),
        ..Default::default()
    };

    // Try postqueue -j (JSON output, available in newer Postfix)
    let output = Command::new("postqueue")
        .arg("-j")
        .output();

    match output {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // postqueue -j outputs one JSON object per line (NDJSON)
            for line in stdout.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                if let Ok(entry) = serde_json::from_str::<PostqueueEntry>(line) {
                    match entry.queue_name.as_deref() {
                        Some("active") => snapshot.active += 1,
                        Some("deferred") => snapshot.deferred += 1,
                        Some("hold") => snapshot.hold += 1,
                        Some("bounce") | Some("corrupt") => snapshot.bounce += 1,
                        _ => {}
                    }
                }
            }
            snapshot.total = snapshot.active + snapshot.deferred + snapshot.hold + snapshot.bounce;
        }
        Ok(_) => {
            // postqueue -j failed, try fallback with postqueue -p
            if let Ok(output) = Command::new("postqueue").arg("-p").output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                // Count lines that look like queue entries (start with hex queue ID)
                let queue_lines = stdout
                    .lines()
                    .filter(|l| l.len() > 10 && l.chars().next().map(|c| c.is_ascii_hexdigit()).unwrap_or(false))
                    .count();
                snapshot.total = queue_lines as u32;
                // Can't distinguish types with -p, put all in active
                snapshot.active = snapshot.total;
            }
        }
        Err(e) => {
            debug!("postqueue not available: {}", e);
        }
    }

    snapshot
}
