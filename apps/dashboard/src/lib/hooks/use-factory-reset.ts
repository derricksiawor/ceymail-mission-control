"use client";

import { useMutation } from "@tanstack/react-query";

export function useFactoryReset() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/factory-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        let msg = "Factory reset failed";
        try {
          const body = await res.json();
          msg = body.error || msg;
        } catch {
          // Response is not JSON
        }
        throw new Error(msg);
      }
      return res.json() as Promise<{ success: boolean }>;
    },
  });
}
