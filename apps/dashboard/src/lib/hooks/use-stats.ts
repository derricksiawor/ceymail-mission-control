"use client";

import { useQuery } from "@tanstack/react-query";

export interface SystemStats {
  cpu_percent: number;
  memory_total: number;
  memory_used: number;
  disk_total: number;
  disk_used: number;
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
  current: HealthSnapshot | null;
  history: HealthSnapshot[];
  memory_total_bytes: number;
  disk_total_bytes: number;
}

async function fetchStatsAll(): Promise<StatsResponse> {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

const statsQueryOptions = {
  queryKey: ["stats-all"],
  queryFn: fetchStatsAll,
  refetchInterval: 10000,
};

export function useStats() {
  return useQuery({
    ...statsQueryOptions,
    select: (data: StatsResponse): SystemStats | null => {
      if (!data.current) return null;
      return {
        cpu_percent: data.current.cpu_percent ?? 0,
        memory_total: data.memory_total_bytes ?? 0,
        memory_used: data.current.memory_used_bytes ?? 0,
        disk_total: data.disk_total_bytes ?? 0,
        disk_used: data.current.disk_used_bytes ?? 0,
      };
    },
  });
}

export function useStatsHistory() {
  return useQuery({
    ...statsQueryOptions,
    select: (data: StatsResponse) => ({
      history: data.history,
      memory_total_bytes: data.memory_total_bytes ?? 0,
      disk_total_bytes: data.disk_total_bytes ?? 0,
    }),
  });
}
