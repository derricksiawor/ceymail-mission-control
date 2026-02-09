"use client";

import { useQuery } from "@tanstack/react-query";

export interface LogEntry {
  id?: number;
  timestamp: string;
  level: "debug" | "info" | "warning" | "error";
  source: string;
  message: string;
}

function deriveLevel(action: string): LogEntry["level"] {
  const lower = action.toLowerCase();
  if (lower.includes("fail") || lower.includes("error") || lower.includes("denied") || lower.includes("block")) return "error";
  if (lower.includes("delete") || lower.includes("remove") || lower.includes("reset") || lower.includes("reject")) return "warning";
  if (lower.includes("debug") || lower.includes("trace")) return "debug";
  return "info";
}

async function fetchRecentLogs(): Promise<LogEntry[]> {
  const res = await fetch("/api/logs?limit=100");
  if (!res.ok) throw new Error("Failed to fetch logs");
  const data = await res.json();

  // Map audit_logs columns to LogEntry format
  // API returns: id, user_id, action, target, detail, ip_address, created_at
  return data.map((log: { id: number; created_at: string; action: string; user_id: number | null; target: string | null; detail: string | null; ip_address: string | null }) => ({
    id: log.id,
    timestamp: log.created_at,
    level: deriveLevel(log.action),
    source: log.user_id ? `user:${log.user_id}` : "system",
    message: `[${log.action}]${log.target ? ` ${log.target}` : ""}${log.detail ? ` - ${log.detail}` : ""}`,
  }));
}

export function useLogs() {
  return useQuery({
    queryKey: ["logs"],
    queryFn: fetchRecentLogs,
    refetchInterval: 5000,
  });
}
