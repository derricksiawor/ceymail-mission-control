"use client";

import { useState, useMemo } from "react";
import {
  Server, Play, Square, RotateCw, RefreshCw, ChevronDown, ChevronUp,
  MemoryStick, Clock, Loader2,
} from "lucide-react";
import { cn, formatBytes, formatUptime } from "@/lib/utils";
import { useServices, useServiceControl } from "@/lib/hooks/use-services";
import type { ServiceInfo } from "@/lib/hooks/use-services";

const SERVICE_DISPLAY: Record<string, { displayName: string; description: string }> = {
  postfix:       { displayName: "Postfix MTA",    description: "Mail Transfer Agent - handles SMTP email delivery and reception" },
  dovecot:       { displayName: "Dovecot IMAP",   description: "IMAP/POP3 server - provides mailbox access for email clients" },
  opendkim:      { displayName: "OpenDKIM",        description: "DKIM signing and verification service for email authentication" },
  spamassassin:  { displayName: "SpamAssassin",    description: "Email spam filtering daemon using content analysis and heuristics" },
  spamd:         { displayName: "SpamAssassin",    description: "Email spam filtering daemon using content analysis and heuristics" },
  mariadb:       { displayName: "MariaDB",         description: "Relational database server for mail account and configuration storage" },
  apache2:       { displayName: "Apache HTTP",     description: "Web server for webmail, admin panels, and HTTP services" },
  unbound:       { displayName: "Unbound DNS",     description: "Recursive DNS resolver for local DNS lookups and caching" },
  rsyslog:       { displayName: "Rsyslog",         description: "System logging daemon for collecting and managing log messages" },
  nginx:         { displayName: "Nginx",           description: "High-performance reverse proxy and web server" },
};

function getDisplay(name: string) {
  return SERVICE_DISPLAY[name] ?? {
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    description: `System service: ${name}`,
  };
}

/** Normalize the API status to our UI status set */
function normalizeStatus(status: ServiceInfo["status"]): "running" | "stopped" | "failed" | "unknown" {
  if (status === "active" || status === "running") return "running";
  return status;
}

export default function ServicesPage() {
  const { data: services, isLoading, isError, error } = useServices();
  const serviceControl = useServiceControl();
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [actionsInProgress, setActionsInProgress] = useState<Set<string>>(new Set());

  const handleAction = (serviceName: string, action: "start" | "stop" | "restart") => {
    const key = `${serviceName}-${action}`;
    setActionsInProgress((prev) => new Set(prev).add(key));
    serviceControl.mutate(
      { service: serviceName, action },
      {
        onSettled: () => {
          setActionsInProgress((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        },
      }
    );
  };

  const serviceList = services ?? [];
  const { runningCount, stoppedCount } = useMemo(() => {
    let running = 0, stopped = 0;
    for (const s of serviceList) {
      const ns = normalizeStatus(s.status);
      if (ns === "running") running++;
      else if (ns === "stopped" || ns === "failed") stopped++;
    }
    return { runningCount: running, stoppedCount: stopped };
  }, [serviceList]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-mc-accent" />
          <p className="text-sm text-mc-text-muted">Loading services...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Server className="h-8 w-8 text-mc-danger" />
          <p className="text-sm text-mc-danger">Failed to load services</p>
          <p className="text-xs text-mc-text-muted">{error?.message ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-mc-text">Services</h1>
          <p className="text-sm text-mc-text-muted">Manage mail server services and processes</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-accent/10">
              <Server className="h-5 w-5 text-mc-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{serviceList.length}</p>
              <p className="text-xs text-mc-text-muted">Total Services</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-success/10">
              <Play className="h-5 w-5 text-mc-success" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{runningCount}</p>
              <p className="text-xs text-mc-text-muted">Running</p>
            </div>
          </div>
        </div>
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-text-muted/10">
              <Square className="h-5 w-5 text-mc-text-muted" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{stoppedCount}</p>
              <p className="text-xs text-mc-text-muted">Stopped</p>
            </div>
          </div>
        </div>
      </div>

      {/* Service Cards */}
      <div className="space-y-4">
        {serviceList.map((service) => {
          const display = getDisplay(service.name);
          const status = normalizeStatus(service.status);
          const isExpanded = expandedService === service.name;
          const isActionRunning = [...actionsInProgress].some((k) => k.startsWith(service.name));
          const uptimeDisplay = service.uptime_formatted ?? formatUptime(service.uptime_seconds);

          return (
            <div
              key={service.name}
              className={cn(
                "rounded-xl border bg-mc-surface overflow-hidden transition-colors",
                status === "running" && "border-mc-border",
                status === "stopped" && "border-mc-border",
                status === "failed" && "border-mc-danger/30",
                status === "unknown" && "border-mc-warning/30"
              )}
            >
              {/* Service Header */}
              <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        status === "running" && "bg-mc-success animate-pulse",
                        status === "stopped" && "bg-mc-text-muted",
                        status === "failed" && "bg-mc-danger animate-pulse",
                        status === "unknown" && "bg-mc-warning animate-pulse"
                      )}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-mc-text">{display.displayName}</h3>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          status === "running" && "bg-mc-success/10 text-mc-success",
                          status === "stopped" && "bg-mc-text-muted/10 text-mc-text-muted",
                          status === "failed" && "bg-mc-danger/10 text-mc-danger",
                          status === "unknown" && "bg-mc-warning/10 text-mc-warning"
                        )}
                      >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </span>
                    </div>
                    <p className="text-xs text-mc-text-muted">{display.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Quick metrics */}
                  {status === "running" && (
                    <div className="hidden items-center gap-4 lg:flex">
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">Uptime</p>
                        <p className="flex items-center gap-1 text-xs font-medium text-mc-text">
                          <Clock className="h-3 w-3 text-mc-text-muted" />
                          {uptimeDisplay}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">Memory</p>
                        <p className="flex items-center gap-1 text-xs font-medium text-mc-text">
                          <MemoryStick className="h-3 w-3 text-mc-text-muted" />
                          {formatBytes(service.memory_bytes)}
                        </p>
                      </div>
                      {service.pid && (
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">PID</p>
                          <p className="font-mono text-xs font-medium text-mc-text">{service.pid}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-1">
                    {status === "stopped" || status === "failed" ? (
                      <button
                        onClick={() => handleAction(service.name, "start")}
                        disabled={!!isActionRunning}
                        className={cn(
                          "flex items-center gap-1 rounded-md bg-mc-success/10 px-2.5 py-1.5 text-xs font-medium text-mc-success transition-colors hover:bg-mc-success/20 sm:px-3 sm:py-2 min-h-[44px]",
                          isActionRunning && "cursor-not-allowed opacity-50"
                        )}
                      >
                        {actionsInProgress.has(`${service.name}-start`) ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Start
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAction(service.name, "stop")}
                        disabled={!!isActionRunning}
                        className={cn(
                          "flex items-center gap-1 rounded-md bg-mc-danger/10 px-2.5 py-1.5 text-xs font-medium text-mc-danger transition-colors hover:bg-mc-danger/20 sm:px-3 sm:py-2 min-h-[44px]",
                          isActionRunning && "cursor-not-allowed opacity-50"
                        )}
                      >
                        {actionsInProgress.has(`${service.name}-stop`) ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Square className="h-3 w-3" />
                        )}
                        Stop
                      </button>
                    )}
                    <button
                      onClick={() => handleAction(service.name, "restart")}
                      disabled={!!isActionRunning || status === "stopped"}
                      className={cn(
                        "flex items-center gap-1 rounded-md bg-mc-accent/10 px-2.5 py-1.5 text-xs font-medium text-mc-accent transition-colors hover:bg-mc-accent/20 sm:px-3 sm:py-2 min-h-[44px]",
                        (isActionRunning || status === "stopped") && "cursor-not-allowed opacity-50"
                      )}
                    >
                      {actionsInProgress.has(`${service.name}-restart`) ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCw className="h-3 w-3" />
                      )}
                      Restart
                    </button>
                  </div>

                  {/* Expand/Collapse */}
                  <button
                    onClick={() => setExpandedService(isExpanded ? null : service.name)}
                    className="flex items-center justify-center rounded-lg p-2.5 text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text sm:p-1.5 min-h-[44px] min-w-[44px]"
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="border-t border-mc-border">
                  {/* Metrics row for mobile */}
                  {status === "running" && (
                    <div className="grid grid-cols-2 gap-4 border-b border-mc-border px-6 py-3 sm:grid-cols-3 lg:hidden">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">Uptime</p>
                        <p className="text-sm font-medium text-mc-text">{uptimeDisplay}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">Memory</p>
                        <p className="text-sm font-medium text-mc-text">{formatBytes(service.memory_bytes)}</p>
                      </div>
                      {service.pid && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">PID</p>
                          <p className="font-mono text-sm font-medium text-mc-text">{service.pid}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Service info */}
                  <div className="px-6 py-4">
                    <div className="rounded-lg border border-mc-border bg-mc-bg p-4">
                      <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">Service Name</p>
                          <p className="font-mono text-mc-text">{service.name}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">Status</p>
                          <p className="text-mc-text">{status.charAt(0).toUpperCase() + status.slice(1)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">PID</p>
                          <p className="font-mono text-mc-text">{service.pid ?? "N/A"}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">Memory</p>
                          <p className="text-mc-text">{service.memory_bytes > 0 ? formatBytes(service.memory_bytes) : "N/A"}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
