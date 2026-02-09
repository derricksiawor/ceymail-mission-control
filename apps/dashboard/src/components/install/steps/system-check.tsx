"use client";

import { cn } from "@/lib/utils";
import {
  HardDrive,
  Cpu,
  MemoryStick,
  Monitor,
  Globe,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";

interface SystemRequirement {
  label: string;
  value: string;
  status: "checking" | "pass" | "fail";
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
}

interface SystemCheckProps {
  onValidChange: (valid: boolean) => void;
  onWebServerDetected?: (webServer: "nginx" | "apache" | "none") => void;
  onServerIpDetected?: (ip: string) => void;
}

export function SystemCheck({ onValidChange, onWebServerDetected, onServerIpDetected }: SystemCheckProps) {
  // Stabilize callbacks to prevent useEffect re-runs on every render
  const onValidChangeRef = useRef(onValidChange);
  onValidChangeRef.current = onValidChange;
  const onWebServerDetectedRef = useRef(onWebServerDetected);
  onWebServerDetectedRef.current = onWebServerDetected;
  const onServerIpDetectedRef = useRef(onServerIpDetected);
  onServerIpDetectedRef.current = onServerIpDetected;

  const [requirements, setRequirements] = useState<SystemRequirement[]>([
    {
      label: "Operating System",
      value: "Checking...",
      status: "checking",
      icon: Monitor,
      detail: "Debian 11+ or Ubuntu 20.04+ required",
    },
    {
      label: "Disk Space",
      value: "Checking...",
      status: "checking",
      icon: HardDrive,
      detail: "Minimum 10 GB free space required",
    },
    {
      label: "RAM",
      value: "Checking...",
      status: "checking",
      icon: MemoryStick,
      detail: "Minimum 1 GB RAM required",
    },
    {
      label: "CPU Cores",
      value: "Checking...",
      status: "checking",
      icon: Cpu,
      detail: "Minimum 1 CPU core required",
    },
    {
      label: "Web Server",
      value: "Checking...",
      status: "checking",
      icon: Globe,
      detail: "nginx or Apache required for SSL termination",
    },
  ]);

  useEffect(() => {
    let cancelled = false;

    async function runCheck() {
      try {
        const res = await fetch("/api/install/system-check");
        if (!res.ok) throw new Error("System check failed");
        const data = await res.json() as {
          checks: { label: string; value: string; status: "pass" | "fail"; detail: string }[];
          webServer: "nginx" | "apache" | "none";
          serverIp?: string;
        };

        if (cancelled) return;

        // Map results to requirements preserving icons
        const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
          "Operating System": Monitor,
          "Disk Space": HardDrive,
          "RAM": MemoryStick,
          "CPU Cores": Cpu,
          "Web Server": Globe,
        };

        const updated = data.checks.map((item) => ({
          ...item,
          icon: iconMap[item.label] || Monitor,
        }));

        setRequirements(updated);

        const allPassed = data.checks.every((r) => r.status === "pass");
        onValidChangeRef.current(allPassed);
        onWebServerDetectedRef.current?.(data.webServer);
        if (data.serverIp) onServerIpDetectedRef.current?.(data.serverIp);
      } catch {
        if (cancelled) return;
        // On API failure, show error state
        setRequirements((prev) =>
          prev.map((r) => ({
            ...r,
            value: "Error checking",
            status: "fail" as const,
          }))
        );
        onValidChangeRef.current(false);
      }
    }

    runCheck();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- refs are stable

  const allPassed = requirements.every((r) => r.status === "pass");
  const anyFailed = requirements.some((r) => r.status === "fail");
  const checking = requirements.some((r) => r.status === "checking");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-mc-text">
          System Prerequisites
        </h3>
        <p className="mt-1 text-sm text-mc-text-muted">
          Verifying your server meets the minimum requirements for CeyMail.
        </p>
      </div>

      <div className="space-y-3">
        {requirements.map((req) => {
          const Icon = req.icon;
          return (
            <div
              key={req.label}
              className={cn(
                "flex items-center gap-4 rounded-lg border p-4 transition-all duration-300",
                req.status === "pass" &&
                  "border-mc-success/30 bg-mc-success/5",
                req.status === "fail" &&
                  "border-mc-danger/30 bg-mc-danger/5",
                req.status === "checking" &&
                  "border-mc-border bg-mc-surface"
              )}
            >
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  req.status === "pass" && "bg-mc-success/10 text-mc-success",
                  req.status === "fail" && "bg-mc-danger/10 text-mc-danger",
                  req.status === "checking" &&
                    "bg-mc-accent/10 text-mc-accent"
                )}
              >
                <Icon className="h-5 w-5" />
              </div>

              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-mc-text">
                    {req.label}
                  </p>
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      req.status === "pass" && "text-mc-success",
                      req.status === "fail" && "text-mc-danger",
                      req.status === "checking" && "text-mc-text-muted"
                    )}
                  >
                    {req.value}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-mc-text-muted">
                  {req.detail}
                </p>
              </div>

              <div className="shrink-0">
                {req.status === "checking" && (
                  <Loader2 className="h-5 w-5 animate-spin text-mc-accent" />
                )}
                {req.status === "pass" && (
                  <CheckCircle2 className="h-5 w-5 text-mc-success" />
                )}
                {req.status === "fail" && (
                  <XCircle className="h-5 w-5 text-mc-danger" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary banner */}
      {!checking && (
        <div
          className={cn(
            "rounded-lg border p-4 text-sm",
            allPassed
              ? "border-mc-success/30 bg-mc-success/5 text-mc-success"
              : "border-mc-danger/30 bg-mc-danger/5 text-mc-danger"
          )}
        >
          {allPassed
            ? "All system requirements met. You can proceed with the installation."
            : anyFailed
              ? "Some system requirements are not met. Please resolve the issues above before continuing."
              : "Checking system requirements..."}
        </div>
      )}
    </div>
  );
}
