"use client";

import { useQuery } from "@tanstack/react-query";

export interface LogEntry {
  id?: number;
  timestamp: string;
  level: "debug" | "info" | "warning" | "error";
  source: string;
  message: string;
}

async function fetchRecentLogs(): Promise<LogEntry[]> {
  const res = await fetch("/api/logs?limit=100");
  if (!res.ok) throw new Error("Failed to fetch logs");
  const data = await res.json();

  // Map audit_logs to LogEntry format
  return data.map((log: { id: number; timestamp: string; action: string; actor: string; target: string; success: boolean; details: string | null }) => ({
    id: log.id,
    timestamp: log.timestamp,
    level: log.success ? "info" as const : "error" as const,
    source: log.actor,
    message: `[${log.action}] ${log.target}${log.details ? ` - ${log.details}` : ""}`,
  }));
}

export function useLogs() {
  return useQuery({
    queryKey: ["logs"],
    queryFn: fetchRecentLogs,
    refetchInterval: 5000,
  });
}
