"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Backup {
  id: string;
  date: string;
  time: string;
  size: number;
  contents: {
    config: boolean;
    database: boolean;
    dkim: boolean;
    mailboxes: boolean;
  };
  status: "complete" | "in-progress" | "failed";
}

async function fetchBackups(): Promise<Backup[]> {
  const res = await fetch("/api/backup");
  if (!res.ok) throw new Error("Failed to fetch backups");
  return res.json();
}

export function useBackups() {
  return useQuery({
    queryKey: ["backups"],
    queryFn: fetchBackups,
  });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contents: { config: boolean; database: boolean; dkim: boolean; mailboxes: boolean }) => {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contents),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create backup");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}

export function useDeleteBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backup?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete backup");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["backups"] });
    },
  });
}
