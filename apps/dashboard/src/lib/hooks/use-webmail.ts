"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface WebmailStatus {
  installed: boolean;
  url: string | null;
  status: "running" | "stopped" | "unknown";
  version: string | null;
  domain: string | null;
  webServer: "nginx" | "apache2" | "unknown";
}

async function fetchWebmailStatus(): Promise<WebmailStatus> {
  const res = await fetch("/api/webmail");
  if (!res.ok) {
    let msg = "Failed to fetch webmail status";
    try {
      const body = await res.json();
      msg = body.error || msg;
    } catch {
      // Response is not JSON
    }
    throw new Error(msg);
  }
  return res.json();
}

export function useWebmailStatus() {
  return useQuery({
    queryKey: ["webmail"],
    queryFn: fetchWebmailStatus,
    refetchInterval: 10_000,
  });
}

export interface SetupWebmailResult {
  success: boolean;
  webmailUrl: string;
  dnsInstructions: string[];
}

export function useSetupWebmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ domain, adminEmail }: { domain: string; adminEmail: string }) => {
      const res = await fetch("/api/webmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, adminEmail }),
      });
      if (!res.ok) {
        let errorMessage = "Failed to setup webmail";
        try {
          const err = await res.json();
          errorMessage = err.error || errorMessage;
        } catch {
          // Response is not JSON
        }
        throw new Error(errorMessage);
      }
      return res.json() as Promise<SetupWebmailResult>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webmail"] });
    },
  });
}
