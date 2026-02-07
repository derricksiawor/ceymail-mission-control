"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DkimKey {
  id: number;
  domain: string;
  selector: string;
  publicKey: string;
  dnsRecord: string;
  status: "active" | "missing" | "pending";
  createdAt: string;
  keySize: number;
}

async function fetchDkimKeys(): Promise<DkimKey[]> {
  const res = await fetch("/api/dkim");
  if (!res.ok) throw new Error("Failed to fetch DKIM keys");
  return res.json();
}

export function useDkimKeys() {
  return useQuery({
    queryKey: ["dkim"],
    queryFn: fetchDkimKeys,
  });
}

export function useGenerateDkim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ domain, selector = "mail", bits = 2048 }: { domain: string; selector?: string; bits?: number }) => {
      const res = await fetch("/api/dkim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, selector, bits }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate DKIM key");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dkim"] });
    },
  });
}

export function useDeleteDkim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (domain: string) => {
      const res = await fetch(`/api/dkim?domain=${encodeURIComponent(domain)}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete DKIM key");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dkim"] });
    },
  });
}
