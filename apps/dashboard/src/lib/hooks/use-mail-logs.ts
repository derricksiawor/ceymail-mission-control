"use client";

import { useQuery } from "@tanstack/react-query";

export interface MailLogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warning" | "error" | "debug";
  source: string;
  message: string;
}

async function fetchMailLogs(): Promise<MailLogEntry[]> {
  const res = await fetch("/api/logs/mail?limit=100");
  if (!res.ok) {
    // Read the server's diagnostic message (e.g. 403 permission error)
    // so the frontend can display it instead of a generic "failed" message.
    let serverMessage = "Failed to fetch mail logs";
    try {
      const body = await res.json();
      if (body?.error) serverMessage = body.error;
    } catch { /* response body wasn't JSON */ }
    throw new Error(serverMessage);
  }
  return res.json();
}

export function useMailLogs() {
  return useQuery({
    queryKey: ["mail-logs"],
    queryFn: fetchMailLogs,
    refetchInterval: 5000,
  });
}
