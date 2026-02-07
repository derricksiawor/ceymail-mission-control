"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface ServiceInfo {
  name: string;
  status: "running" | "stopped" | "failed" | "unknown" | "active";
  uptime_seconds: number;
  uptime_formatted?: string;
  memory_bytes: number;
  pid: number | null;
}

async function fetchServices(): Promise<ServiceInfo[]> {
  const res = await fetch("/api/services");
  if (!res.ok) throw new Error("Failed to fetch services");
  return res.json();
}

export function useServices() {
  return useQuery({
    queryKey: ["services"],
    queryFn: fetchServices,
    refetchInterval: 5000,
  });
}

export function useServiceControl() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ service, action }: { service: string; action: string }) => {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, action }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Service control failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
    },
  });
}
