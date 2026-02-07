use chrono::Utc;
use inotify::{EventMask, Inotify, WatchMask};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::fs::File;
use std::path::Path;
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: chrono::DateTime<Utc>,
    pub level: LogLevel,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum LogLevel {
    Debug,
    Info,
    Warning,
    Error,
}

impl LogLevel {
    pub fn from_line(line: &str) -> Self {
        let lower = line.to_lowercase();
        if lower.contains("error") || lower.contains("fatal") || lower.contains("panic") {
            LogLevel::Error
        } else if lower.contains("warn") || lower.contains("reject") {
            LogLevel::Warning
        } else if lower.contains("debug") {
            LogLevel::Debug
        } else {
            LogLevel::Info
        }
    }
}

/// Parse a mail.log line to extract the source service
fn parse_source(line: &str) -> String {
    // Mail log format: "Mon DD HH:MM:SS hostname service[pid]: message"
    let parts: Vec<&str> = line.splitn(6, ' ').collect();
    if parts.len() >= 5 {
        parts[4]
            .split('[')
            .next()
            .unwrap_or("unknown")
            .to_string()
    } else {
        "unknown".to_string()
    }
}

pub struct LogWatcher {
    sender: broadcast::Sender<LogEntry>,
    handle: Option<JoinHandle<()>>,
}

impl LogWatcher {
    /// Create a new log watcher. Returns the watcher and a receiver for log entries.
    pub fn new(buffer_size: usize) -> (Self, broadcast::Receiver<LogEntry>) {
        let (sender, receiver) = broadcast::channel(buffer_size);
        (
            Self {
                sender,
                handle: None,
            },
            receiver,
        )
    }

    /// Get a new receiver for log entries
    pub fn subscribe(&self) -> broadcast::Receiver<LogEntry> {
        self.sender.subscribe()
    }

    /// Start watching the specified log file
    pub fn start(&mut self, log_path: &str) {
        let sender = self.sender.clone();
        let path = log_path.to_string();

        let handle = tokio::spawn(async move {
            if let Err(e) = watch_log_file(&path, sender).await {
                error!("Log watcher error: {}", e);
            }
        });

        self.handle = Some(handle);
        info!("Log watcher started for: {}", log_path);
    }

    /// Stop the log watcher
    pub fn stop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
            info!("Log watcher stopped");
        }
    }

    /// Read the last N lines from the log file (for initial load)
    pub fn tail_lines(log_path: &str, n: usize) -> Vec<LogEntry> {
        let path = Path::new(log_path);
        if !path.exists() {
            return Vec::new();
        }

        let file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };

        let reader = BufReader::new(file);
        let all_lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();
        let start = if all_lines.len() > n { all_lines.len() - n } else { 0 };

        all_lines[start..]
            .iter()
            .map(|line| LogEntry {
                timestamp: Utc::now(),
                level: LogLevel::from_line(line),
                source: parse_source(line),
                message: line.clone(),
            })
            .collect()
    }
}

async fn watch_log_file(
    path: &str,
    sender: broadcast::Sender<LogEntry>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let log_path = Path::new(path);

    // Wait for file to exist
    while !log_path.exists() {
        warn!("Log file not found: {}, retrying in 5s", path);
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }

    let mut inotify = Inotify::init()?;
    inotify.watches().add(log_path, WatchMask::MODIFY)?;

    let mut file = File::open(log_path)?;
    // Seek to end - only watch new entries
    file.seek(SeekFrom::End(0))?;
    let mut reader = BufReader::new(file);

    info!("Watching log file: {}", path);

    loop {
        // Wait for inotify event using blocking in a spawn_blocking context
        let mut inotify_buffer = [0u8; 4096];

        // Use tokio blocking to wait for inotify events
        let has_events = tokio::task::spawn_blocking({
            let mut inotify_clone = inotify;
            move || {
                let events = inotify_clone.read_events_blocking(&mut inotify_buffer);
                let has = events.map(|e| e.count() > 0).unwrap_or(false);
                (inotify_clone, has)
            }
        })
        .await;

        match has_events {
            Ok((returned_inotify, true)) => {
                inotify = returned_inotify;
                // Read new lines
                let mut line = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 {
                    let trimmed = line.trim().to_string();
                    if !trimmed.is_empty() {
                        let entry = LogEntry {
                            timestamp: Utc::now(),
                            level: LogLevel::from_line(&trimmed),
                            source: parse_source(&trimmed),
                            message: trimmed,
                        };
                        let _ = sender.send(entry);
                    }
                    line.clear();
                }
            }
            Ok((returned_inotify, false)) => {
                inotify = returned_inotify;
            }
            Err(e) => {
                error!("Inotify task error: {}", e);
                break;
            }
        }
    }

    Ok(())
}
