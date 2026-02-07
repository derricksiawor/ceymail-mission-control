use mc_actors::log_watcher::{LogEntry, LogLevel, LogWatcher};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::Stream;
use std::pin::Pin;

pub struct LogService {
    watcher: LogWatcher,
}

impl LogService {
    pub fn new(watcher: LogWatcher) -> Self {
        Self { watcher }
    }

    /// Get a stream of log entries
    pub fn stream_logs(
        &self,
        service_filter: Option<Vec<String>>,
        level_filter: Option<LogLevel>,
    ) -> broadcast::Receiver<LogEntry> {
        self.watcher.subscribe()
    }

    /// Get the last N log lines
    pub fn tail(&self, lines: usize) -> Vec<LogEntry> {
        LogWatcher::tail_lines("/var/log/mail.log", lines)
    }
}
