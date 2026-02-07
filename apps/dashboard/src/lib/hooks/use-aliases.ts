"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Alias {
  id: number;
  source: string;
  destination: string;
  domain_id: number;
  domain_name?: string;
  created_at?: string;
}

async function fetchAliases(): Promise<Alias[]> {
  const res = await fetch("/api/aliases");
  if (!res.ok) throw new Error("Failed to fetch aliases");
  return res.json();
}

export function useAliases() {
  return useQuery({
    queryKey: ["aliases"],
    queryFn: fetchAliases,
  });
}

export function useCreateAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { source: string; destination: string; domain_id: number }) => {
      const res = await fetch("/api/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create alias");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aliases"] });
    },
  });
}

export function useDeleteAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/aliases?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete alias");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["aliases"] });
    },
  });
}
