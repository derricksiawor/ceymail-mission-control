"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface QueueStats {
  active: number;
  deferred: number;
  hold: number;
  bounce: number;
  total: number;
}

async function fetchQueueStats(): Promise<QueueStats> {
  const res = await fetch("/api/queue");
  if (!res.ok) throw new Error("Failed to fetch queue stats");
  return res.json();
}

export function useQueue() {
  return useQuery({
    queryKey: ["queue"],
    queryFn: fetchQueueStats,
    refetchInterval: 5000,
  });
}

export function useFlushQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "flush" }),
      });
      if (!res.ok) throw new Error("Failed to flush queue");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}

export function useClearQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      if (!res.ok) throw new Error("Failed to clear queue");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });
}
