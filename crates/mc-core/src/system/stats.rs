use sysinfo::{System, Disks, Networks, CpuRefreshKind, MemoryRefreshKind, RefreshKind};
use serde::Serialize;

/// Per-core CPU usage
#[derive(Debug, Clone, Serialize)]
pub struct CpuStats {
    pub per_core_usage: Vec<f32>,
    pub load_avg_1: f64,
    pub load_avg_5: f64,
    pub load_avg_15: f64,
}

/// Memory usage statistics
#[derive(Debug, Clone, Serialize)]
pub struct MemoryStats {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

/// Disk usage for a single mount point
#[derive(Debug, Clone, Serialize)]
pub struct DiskStats {
    pub mount_point: String,
    pub device: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub filesystem: String,
}

/// Network usage for a single interface
#[derive(Debug, Clone, Serialize)]
pub struct NetworkStats {
    pub interface: String,
    pub bytes_received: u64,
    pub bytes_transmitted: u64,
}

/// Aggregated system statistics
#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
    pub cpu: CpuStats,
    pub memory: MemoryStats,
    pub disks: Vec<DiskStats>,
    pub network: Vec<NetworkStats>,
}

/// Collect current system statistics using the sysinfo crate.
///
/// This refreshes CPU, memory, disk, and network data and returns a snapshot
/// of the current system state.
pub fn collect_stats() -> SystemStats {
    // Create system with CPU and memory refresh
    let mut sys = System::new();

    // Refresh CPU (need two refreshes with a delay for accurate usage)
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();

    // Refresh memory
    sys.refresh_memory();

    // CPU stats
    let per_core_usage: Vec<f32> = sys.cpus().iter().map(|cpu| cpu.cpu_usage()).collect();
    let load_avg = System::load_average();
    let cpu = CpuStats {
        per_core_usage,
        load_avg_1: load_avg.one,
        load_avg_5: load_avg.five,
        load_avg_15: load_avg.fifteen,
    };

    // Memory stats
    let memory = MemoryStats {
        total_bytes: sys.total_memory(),
        used_bytes: sys.used_memory(),
        available_bytes: sys.available_memory(),
        swap_total_bytes: sys.total_swap(),
        swap_used_bytes: sys.used_swap(),
    };

    // Disk stats
    let disks_info = Disks::new_with_refreshed_list();
    let disks: Vec<DiskStats> = disks_info.iter().map(|disk| {
        let total = disk.total_space();
        let available = disk.available_space();
        DiskStats {
            mount_point: disk.mount_point().to_string_lossy().to_string(),
            device: disk.name().to_string_lossy().to_string(),
            total_bytes: total,
            used_bytes: total.saturating_sub(available),
            available_bytes: available,
            filesystem: disk.file_system().to_string_lossy().to_string(),
        }
    }).collect();

    // Network stats
    let networks = Networks::new_with_refreshed_list();
    let network: Vec<NetworkStats> = networks.iter().map(|(name, data)| {
        NetworkStats {
            interface: name.clone(),
            bytes_received: data.total_received(),
            bytes_transmitted: data.total_transmitted(),
        }
    }).collect();

    SystemStats {
        cpu,
        memory,
        disks,
        network,
    }
}
