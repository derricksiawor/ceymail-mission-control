"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLogs } from "@/lib/hooks/use-logs";

type LogLevel = "info" | "warn" | "error" | "debug";

interface MappedLog {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
}

const levelColors: Record<LogLevel, string> = {
  info: "text-mc-success",
  warn: "text-mc-warning",
  error: "text-mc-danger",
  debug: "text-mc-text-muted",
};

const levelBadgeColors: Record<LogLevel, string> = {
  info: "bg-mc-success/10 text-mc-success",
  warn: "bg-mc-warning/10 text-mc-warning",
  error: "bg-mc-danger/10 text-mc-danger",
  debug: "bg-mc-text-muted/10 text-mc-text-muted",
};

function mapLevel(level: string): LogLevel {
  if (level === "warning") return "warn";
  if (level === "info" || level === "warn" || level === "error" || level === "debug") return level;
  return "info";
}

type FilterLevel = "all" | LogLevel;

export function LogTape() {
  const { data: rawLogs, isLoading } = useLogs();
  const [filter, setFilter] = useState<FilterLevel>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const logs: MappedLog[] = (rawLogs ?? []).map((log) => ({
    id: String(log.id ?? log.timestamp),
    timestamp: log.timestamp,
    level: mapLevel(log.level),
    service: log.source,
    message: log.message,
  }));

  const filteredLogs =
    filter === "all"
      ? logs
      : logs.filter((log) => log.level === filter);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  const filterOptions: { label: string; value: FilterLevel }[] = [
    { label: "All", value: "all" },
    { label: "Info", value: "info" },
    { label: "Warn", value: "warn" },
    { label: "Error", value: "error" },
    { label: "Debug", value: "debug" },
  ];

  return (
    <div className="glass-subtle rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-mc-border px-4 py-3">
        <h2 className="text-lg font-semibold text-mc-text">Live Log Stream</h2>
        <div className="flex items-center gap-3">
          {/* Level Filters */}
          <div className="flex items-center gap-1">
            {filterOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  filter === opt.value
                    ? "bg-mc-accent/20 text-mc-accent"
                    : "text-mc-text-muted hover:bg-mc-surface-hover hover:text-mc-text"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Auto-scroll Toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
              autoScroll
                ? "bg-mc-success/20 text-mc-success"
                : "text-mc-text-muted hover:bg-mc-surface-hover"
            )}
          >
            Auto-scroll {autoScroll ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Log Output */}
      <div
        ref={scrollRef}
        className="h-72 overflow-y-auto bg-mc-bg p-4 font-mono text-xs"
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-mc-accent" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <p className="text-mc-text-muted">No log entries match the filter.</p>
        ) : (
          <div className="space-y-1">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-2 leading-relaxed"
              >
                <span className="shrink-0 text-mc-text-muted">
                  {log.timestamp}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    levelBadgeColors[log.level]
                  )}
                >
                  {log.level}
                </span>
                <span className="shrink-0 font-semibold text-mc-info">
                  [{log.service}]
                </span>
                <span className={cn(levelColors[log.level])}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
