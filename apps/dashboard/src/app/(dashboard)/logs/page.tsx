"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import {
  ScrollText, Search, Download, Trash2, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMailLogs, type MailLogEntry } from "@/lib/hooks/use-mail-logs";

const LOG_LEVELS: { value: string; label: string }[] = [
  { value: "All Levels", label: "All Levels" },
  { value: "error", label: "Error only" },
  { value: "warning", label: "Warning & above" },
  { value: "info", label: "Info & above" },
  { value: "debug", label: "Debug & above" },
];
const LEVEL_PRIORITY: Record<string, number> = { error: 0, warning: 1, info: 2, debug: 3 };
const LEVEL_COLORS: Record<string, string> = {
  info: "text-mc-success",
  warning: "text-mc-warning",
  error: "text-mc-danger",
  debug: "text-mc-info",
};

export default function LogsPage() {
  const { data: apiLogs, isLoading, isError } = useMailLogs();
  const exportUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    };
  }, []);

  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("All Services");
  const [levelFilter, setLevelFilter] = useState("All Levels");
  const [cleared, setCleared] = useState(false);

  // Logs source: either the live API data or empty if the user cleared
  const logs: MailLogEntry[] = cleared ? [] : (apiLogs ?? []);

  // Derive unique service names from the log source for the service filter dropdown.
  const services = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      if (log.source) set.add(log.source);
    }
    return Array.from(set).sort();
  }, [logs]);

  const handleClear = () => {
    setCleared(true);
  };

  // When new data arrives after a clear, keep showing empty until the user
  // explicitly "un-clears" by changing a filter or searching, or we can simply
  // reset cleared when the user interacts. We reset on any filter/search change.
  const resetClear = () => {
    if (cleared) setCleared(false);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    resetClear();
  };

  const handleServiceFilterChange = (value: string) => {
    setServiceFilter(value);
    resetClear();
  };

  const handleLevelFilterChange = (value: string) => {
    setLevelFilter(value);
    resetClear();
  };

  const handleExport = () => {
    if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    const content = filteredLogs
      .map((log) => `${log.timestamp} [${log.level.toUpperCase()}] [${log.source}] ${log.message}`)
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    exportUrlRef.current = url;
    const a = document.createElement("a");
    a.href = url;
    const filterParts = [
      levelFilter !== "All Levels" ? levelFilter : "",
      serviceFilter !== "All Services" ? serviceFilter : "",
      search ? "search" : "",
    ].filter(Boolean);
    const filterSuffix = filterParts.length > 0 ? `-${filterParts.join("-")}` : "";
    a.download = `ceymail-logs-${new Date().toISOString().split("T")[0]}${filterSuffix}.log`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (exportUrlRef.current === url) exportUrlRef.current = null;
    }, 10000);
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (serviceFilter !== "All Services") {
        if (log.source !== serviceFilter) return false;
      }
      if (levelFilter !== "All Levels") {
        const filterPriority = LEVEL_PRIORITY[levelFilter] ?? 3;
        const logPriority = LEVEL_PRIORITY[log.level] ?? 3;
        if (logPriority > filterPriority) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          log.message.toLowerCase().includes(q) ||
          log.source.toLowerCase().includes(q) ||
          log.timestamp.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, serviceFilter, levelFilter, search]);

  const { errorCount, warningCount } = useMemo(() => {
    let errors = 0, warnings = 0;
    for (const l of logs) {
      if (l.level === "error") errors++;
      else if (l.level === "warning") warnings++;
    }
    return { errorCount: errors, warningCount: warnings };
  }, [logs]);

  return (
    <div className="flex h-full flex-col space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-mc-text">Logs</h1>
          <p className="text-sm text-mc-text-muted">View and search mail server logs</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 rounded-lg bg-mc-accent/10 px-3.5 py-2.5 text-xs font-medium text-mc-accent transition-colors hover:bg-mc-accent/20 sm:px-3 sm:py-2"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 rounded-lg bg-mc-danger/10 px-3.5 py-2.5 text-xs font-medium text-mc-danger transition-colors hover:bg-mc-danger/20 sm:px-3 sm:py-2"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-mc-border bg-mc-surface px-3 py-2 sm:gap-4 sm:px-4">
          <span className="text-xs text-mc-text-muted">
            <span className="font-mono font-bold text-mc-text">{logs.length}</span> entries
          </span>
          <span className="h-3 w-px bg-mc-border" />
          <span className="text-xs">
            <span className="font-mono font-bold text-mc-danger">{errorCount}</span>{" "}
            <span className="text-mc-text-muted">errors</span>
          </span>
          <span className="h-3 w-px bg-mc-border" />
          <span className="text-xs">
            <span className="font-mono font-bold text-mc-warning">{warningCount}</span>{" "}
            <span className="text-mc-text-muted">warnings</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-mc-text-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mc-success" />
          Polling every 5s
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mc-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search logs..."
            className="w-full rounded-lg border border-mc-border bg-mc-surface py-2 pl-10 pr-4 font-mono text-sm text-mc-text placeholder:text-mc-text-muted focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
          />
        </div>
        <select
          value={serviceFilter}
          onChange={(e) => handleServiceFilterChange(e.target.value)}
          className="rounded-lg border border-mc-border bg-mc-surface px-3 py-2 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
        >
          <option value="All Services">All Services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={levelFilter}
          onChange={(e) => handleLevelFilterChange(e.target.value)}
          className="rounded-lg border border-mc-border bg-mc-surface px-3 py-2 text-sm text-mc-text focus:border-mc-accent focus:outline-none focus:ring-1 focus:ring-mc-accent/50"
        >
          {LOG_LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {/* Log Viewer */}
      <div
        className="flex-1 overflow-auto rounded-xl border border-mc-border bg-mc-bg"
        style={{ minHeight: "400px" }}
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center p-12">
            <div className="text-center">
              <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-mc-accent" />
              <p className="text-sm text-mc-text-muted">Loading logs...</p>
            </div>
          </div>
        ) : isError ? (
          <div className="flex h-full items-center justify-center p-12">
            <div className="text-center">
              <ScrollText className="mx-auto mb-3 h-10 w-10 text-mc-danger/50" />
              <p className="text-sm text-mc-danger">Failed to load logs. Will retry automatically.</p>
            </div>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center p-12">
            <div className="text-center">
              <ScrollText className="mx-auto mb-3 h-10 w-10 text-mc-text-muted/30" />
              <p className="text-sm text-mc-text-muted">
                {logs.length === 0
                  ? "No log entries. Logs will appear here as activity is recorded."
                  : "No logs match your current filters."}
              </p>
            </div>
          </div>
        ) : (
          <div className="p-1">
            {filteredLogs.map((log, index) => (
              <div
                key={log.id ?? index}
                className={cn(
                  "group rounded px-3 py-1.5 font-mono text-xs transition-colors hover:bg-mc-surface-hover",
                  "flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-0",
                  log.level === "error" && "bg-mc-danger/5"
                )}
              >
                {/* Timestamp + Level row on mobile */}
                <div className="flex items-center gap-2 sm:contents">
                  <span className="shrink-0 text-mc-text-muted sm:w-[152px]">
                    {log.timestamp}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-semibold sm:w-[72px] sm:text-center",
                      LEVEL_COLORS[log.level]
                    )}
                  >
                    {log.level.toUpperCase()}
                  </span>
                </div>

                {/* Source (actor) */}
                <span className="shrink-0 text-mc-accent truncate sm:w-[110px]" title={log.source}>
                  {log.source}
                </span>

                {/* Message */}
                <span className="flex-1 break-all text-mc-text">{log.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-mc-text-muted">
        <span>
          Showing {filteredLogs.length} of {logs.length} entries
        </span>
        <span>Auto-refreshes every 5 seconds</span>
      </div>
    </div>
  );
}
