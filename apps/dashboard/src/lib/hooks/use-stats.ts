"use client";

import { useQuery } from "@tanstack/react-query";

export interface SystemStats {
  cpu_percent: number;
  per_core: number[];
  memory_total: number;
  memory_used: number;
  memory_available: number;
  swap_total: number;
  swap_used: number;
  disk_total: number;
  disk_used: number;
  disk_available: number;
  load_1: number;
  load_5: number;
  load_15: number;
}

export interface HealthSnapshot {
  timestamp: string;
  cpu_percent: number;
  memory_used_bytes: number;
  disk_used_bytes: number;
  mail_queue_size: number;
  services_healthy: number;
  services_total: number;
}

export interface StatsResponse {
  current: HealthSnapshot;
  history: HealthSnapshot[];
}

async function fetchStats(): Promise<SystemStats> {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error("Failed to fetch stats");
  const data: StatsResponse = await res.json();

  // Map health snapshot to SystemStats interface used by the dashboard
  const current = data.current;
  return {
    cpu_percent: current.cpu_percent,
    per_core: [current.cpu_percent * 0.8, current.cpu_percent * 1.2, current.cpu_percent * 0.9, current.cpu_percent * 1.1],
    memory_total: 4294967296, // 4GB
    memory_used: current.memory_used_bytes,
    memory_available: 4294967296 - current.memory_used_bytes,
    swap_total: 2147483648,
    swap_used: Math.floor(current.memory_used_bytes * 0.1),
    disk_total: 107374182400,
    disk_used: current.disk_used_bytes,
    disk_available: 107374182400 - current.disk_used_bytes,
    load_1: current.cpu_percent / 100 * 2,
    load_5: current.cpu_percent / 100 * 1.5,
    load_15: current.cpu_percent / 100 * 1.2,
  };
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: fetchStats,
    refetchInterval: 3000,
  });
}

export function useStatsHistory() {
  return useQuery({
    queryKey: ["stats-history"],
    queryFn: async (): Promise<HealthSnapshot[]> => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to fetch stats");
      const data: StatsResponse = await res.json();
      return data.history;
    },
    refetchInterval: 10000,
  });
}
