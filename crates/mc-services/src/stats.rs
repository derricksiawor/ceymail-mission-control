use mc_actors::stats_collector::{StatsCollector, SystemSnapshot};
use tokio::sync::broadcast;

pub struct StatsService {
    collector: StatsCollector,
}

impl StatsService {
    pub fn new(collector: StatsCollector) -> Self {
        Self { collector }
    }

    pub fn stream_stats(&self) -> broadcast::Receiver<SystemSnapshot> {
        self.collector.subscribe()
    }

    pub fn collect_once() -> SystemSnapshot {
        StatsCollector::collect_once()
    }
}
