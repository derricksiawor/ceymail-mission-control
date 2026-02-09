"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface InstallStatus {
  installed: boolean;
  completedAt: string | null;
}

async function fetchInstallStatus(): Promise<InstallStatus> {
  const res = await fetch("/api/install/status");
  if (!res.ok) throw new Error("Failed to fetch install status");
  return res.json();
}

export function useInstallStatus() {
  return useQuery({
    queryKey: ["install-status"],
    queryFn: fetchInstallStatus,
    staleTime: 30_000,
  });
}

export function useCompleteInstall() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/install/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to complete install");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["install-status"] });
    },
  });
}

export function useResetInstall() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/install/status", {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to reset install");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["install-status"] });
    },
  });
}
