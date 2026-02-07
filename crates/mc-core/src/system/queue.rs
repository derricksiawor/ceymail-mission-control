use std::process::Command;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, info};

#[derive(Debug, Error)]
pub enum QueueError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Failed to parse queue output: {0}")]
    ParseError(String),
    #[error("Command failed: {0}")]
    CommandFailed(String),
}

/// Postfix mail queue statistics
#[derive(Debug, Clone, Default, Serialize)]
pub struct QueueStats {
    pub active: u32,
    pub deferred: u32,
    pub bounce: u32,
    pub hold: u32,
    pub total: u32,
}

/// A single entry from `postqueue -j` JSON output
#[derive(Debug, Deserialize)]
struct PostqueueEntry {
    #[serde(default)]
    queue_name: String,
    #[serde(default)]
    queue_id: String,
}

/// Get mail queue statistics by parsing `postqueue -j` (JSON output).
///
/// Uses Command::new().arg() pattern -- never shell interpolation.
pub fn get_queue_stats() -> Result<QueueStats, QueueError> {
    let output = Command::new("postqueue")
        .arg("-j")
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        // Empty queue is not an error -- postqueue may return non-zero
        if stderr.contains("Mail queue is empty") || output.stdout.is_empty() {
            return Ok(QueueStats::default());
        }
        return Err(QueueError::CommandFailed(stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut stats = QueueStats::default();

    // postqueue -j outputs one JSON object per line (JSON Lines format)
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<PostqueueEntry>(line) {
            Ok(entry) => {
                match entry.queue_name.as_str() {
                    "active" => stats.active += 1,
                    "deferred" => stats.deferred += 1,
                    "bounce" => stats.bounce += 1,
                    "hold" => stats.hold += 1,
                    _ => {
                        debug!("Unknown queue name: {}", entry.queue_name);
                    }
                }
            }
            Err(e) => {
                debug!("Failed to parse queue entry: {}", e);
            }
        }
    }

    stats.total = stats.active + stats.deferred + stats.bounce + stats.hold;
    Ok(stats)
}

/// Flush the mail queue, attempting to deliver all queued messages.
///
/// Uses `postqueue -f`.
pub fn flush_queue() -> Result<(), QueueError> {
    let output = Command::new("postqueue")
        .arg("-f")
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(QueueError::CommandFailed(format!(
            "postqueue -f failed: {}", stderr
        )));
    }

    info!("Flushed mail queue");
    Ok(())
}

/// Delete all messages from the mail queue.
///
/// Uses `postsuper -d ALL`.
pub fn delete_all_queued() -> Result<(), QueueError> {
    let output = Command::new("postsuper")
        .arg("-d")
        .arg("ALL")
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(QueueError::CommandFailed(format!(
            "postsuper -d ALL failed: {}", stderr
        )));
    }

    info!("Deleted all queued messages");
    Ok(())
}
