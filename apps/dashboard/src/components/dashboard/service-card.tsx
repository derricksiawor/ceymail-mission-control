"use client";

import { Play, Square, RotateCw, Loader2 } from "lucide-react";
import { cn, formatBytes, formatUptime } from "@/lib/utils";
import { useServiceControl } from "@/lib/hooks/use-services";
import { useState } from "react";

export interface ServiceInfo {
  name: string;
  displayName: string;
  status: "running" | "stopped" | "error" | "starting";
  uptime: number; // seconds
  memoryUsage: number; // bytes
}

const statusConfig: Record<
  ServiceInfo["status"],
  { label: string; color: string; dotColor: string; glowColor: string }
> = {
  running: {
    label: "Running",
    color: "text-mc-success",
    dotColor: "bg-mc-success",
    glowColor: "shadow-mc-success/10",
  },
  stopped: {
    label: "Stopped",
    color: "text-mc-text-muted",
    dotColor: "bg-mc-text-muted",
    glowColor: "",
  },
  error: {
    label: "Error",
    color: "text-mc-danger",
    dotColor: "bg-mc-danger",
    glowColor: "shadow-mc-danger/10",
  },
  starting: {
    label: "Starting",
    color: "text-mc-warning",
    dotColor: "bg-mc-warning",
    glowColor: "shadow-mc-warning/10",
  },
};

interface ServiceCardProps {
  service: ServiceInfo;
}

export function ServiceCard({ service }: ServiceCardProps) {
  const config = statusConfig[service.status];
  const serviceControl = useServiceControl();
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const handleAction = async (action: "start" | "stop" | "restart") => {
    setActionInProgress(action);
    try {
      await serviceControl.mutateAsync({ service: service.name, action });
    } catch {
      // Error handled by TanStack Query
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div
      className={cn(
        "glass-subtle rounded-xl p-4 transition-all hover:shadow-lg",
        service.status === "running" && "shadow-md shadow-mc-success/5"
      )}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              config.dotColor,
              service.status === "running" && "animate-pulse"
            )}
          />
          <h3 className="text-sm font-semibold text-mc-text">
            {service.displayName}
          </h3>
        </div>
        <span className={cn("text-xs font-medium", config.color)}>
          {config.label}
        </span>
      </div>

      {/* Metrics */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">
            Uptime
          </p>
          <p className="text-sm font-medium text-mc-text">
            {service.status === "running"
              ? formatUptime(service.uptime)
              : "--"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">
            Memory
          </p>
          <p className="text-sm font-medium text-mc-text">
            {service.status === "running"
              ? formatBytes(service.memoryUsage)
              : "--"}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        {service.status === "stopped" || service.status === "error" ? (
          <button
            onClick={() => handleAction("start")}
            disabled={actionInProgress !== null}
            aria-label={`Start ${service.displayName}`}
            className="flex min-h-[44px] items-center gap-1 rounded-md bg-mc-success/10 px-3 py-2 text-xs font-medium text-mc-success transition-colors hover:bg-mc-success/20 disabled:opacity-50"
          >
            {actionInProgress === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Start
          </button>
        ) : (
          <button
            onClick={() => handleAction("stop")}
            disabled={actionInProgress !== null}
            aria-label={`Stop ${service.displayName}`}
            className="flex min-h-[44px] items-center gap-1 rounded-md bg-mc-danger/10 px-3 py-2 text-xs font-medium text-mc-danger transition-colors hover:bg-mc-danger/20 disabled:opacity-50"
          >
            {actionInProgress === "stop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            Stop
          </button>
        )}
        <button
          onClick={() => handleAction("restart")}
          disabled={actionInProgress !== null || service.status === "stopped"}
          aria-label={`Restart ${service.displayName}`}
          className="flex min-h-[44px] items-center gap-1 rounded-md bg-mc-accent/10 px-3 py-2 text-xs font-medium text-mc-accent transition-colors hover:bg-mc-accent/20 disabled:opacity-50"
        >
          {actionInProgress === "restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
          Restart
        </button>
      </div>
    </div>
  );
}
