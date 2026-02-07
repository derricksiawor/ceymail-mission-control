"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface AppSettings {
  general: {
    hostname: string;
    adminEmail: string;
    timezone: string;
    maxMessageSize: string;
    smtpBanner: string;
  };
  security: {
    minPasswordLength: number;
    requireUppercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    sessionTimeout: number;
    maxLoginAttempts: number;
    lockoutDuration: number;
    enforceSSL: boolean;
  };
  notifications: {
    enableEmailAlerts: boolean;
    alertRecipient: string;
    notifyOnServiceDown: boolean;
    notifyOnDiskWarning: boolean;
    notifyOnLoginFailure: boolean;
    notifyOnQueueBacklog: boolean;
    diskWarningThreshold: number;
    queueBacklogThreshold: number;
  };
  about: {
    os: string;
    kernel: string;
    architecture: string;
    hostname: string;
    timezone: string;
    components: { name: string; version: string }[];
  };
}

async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch("/api/settings");
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ section, key, value }: { section: string; key: string; value: unknown }) => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, key, value }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update setting");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
