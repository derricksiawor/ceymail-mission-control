"use client";

import {
  ListOrdered,
  Play,
  Pause,
  Trash2,
  Send,
  Clock,
  Ban,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueue, useFlushQueue, useClearQueue } from "@/lib/hooks/use-queue";
import { useState, useEffect, useCallback } from "react";

const statusConfig = {
  active: {
    label: "Active",
    icon: Play,
    color: "text-mc-success",
    bgColor: "bg-mc-success/10",
    barColor: "bg-mc-success",
    description: "Messages currently being delivered",
  },
  deferred: {
    label: "Deferred",
    icon: Clock,
    color: "text-mc-warning",
    bgColor: "bg-mc-warning/10",
    barColor: "bg-mc-warning",
    description: "Messages waiting for retry after temporary failure",
  },
  hold: {
    label: "Hold",
    icon: Pause,
    color: "text-mc-info",
    bgColor: "bg-mc-info/10",
    barColor: "bg-mc-info",
    description: "Messages manually held from delivery",
  },
  bounce: {
    label: "Bounce",
    icon: Ban,
    color: "text-mc-danger",
    bgColor: "bg-mc-danger/10",
    barColor: "bg-mc-danger",
    description: "Messages that failed permanently",
  },
};

export default function QueuePage() {
  const { data: stats, isLoading, isError } = useQueue();
  const flushMutation = useFlushQueue();
  const clearMutation = useClearQueue();
  const [showClearDialog, setShowClearDialog] = useState(false);

  const closeDialogs = useCallback(() => {
    setShowClearDialog(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDialogs();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closeDialogs]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-mc-accent" />
        <span className="ml-3 text-mc-text-muted">Loading queue stats...</span>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-mc-danger">Failed to load queue stats. Will retry automatically.</p>
      </div>
    );
  }

  const isEmpty = stats.total === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-mc-text">Mail Queue</h1>
          <p className="text-sm text-mc-text-muted">
            Monitor and manage the Postfix mail queue
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => flushMutation.mutate()}
            disabled={flushMutation.isPending || isEmpty}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text",
              (flushMutation.isPending || isEmpty) && "cursor-not-allowed opacity-50"
            )}
          >
            {flushMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Flush Queue
          </button>
          <button
            onClick={() => setShowClearDialog(true)}
            disabled={isEmpty}
            className={cn(
              "flex items-center gap-2 rounded-lg border border-mc-danger/30 px-4 py-2 text-sm text-mc-danger transition-colors hover:bg-mc-danger/10",
              isEmpty && "cursor-not-allowed opacity-50"
            )}
          >
            <Trash2 className="h-4 w-4" />
            Clear Queue
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {(["active", "deferred", "hold", "bounce"] as const).map((status) => {
          const cfg = statusConfig[status];
          const Icon = cfg.icon;
          const count = stats[status] ?? 0;
          return (
            <div
              key={status}
              className="glass-subtle rounded-xl p-4"
            >
              <div className="flex items-center gap-3">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", cfg.bgColor)}>
                  <Icon className={cn("h-5 w-5", cfg.color)} />
                </div>
                <div>
                  <p className="text-2xl font-bold text-mc-text">{count}</p>
                  <p className="text-xs text-mc-text-muted">{cfg.label}</p>
                </div>
              </div>
            </div>
          );
        })}
        <div className="glass-subtle rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mc-accent/10">
              <ListOrdered className="h-5 w-5 text-mc-accent" />
            </div>
            <div>
              <p className="text-2xl font-bold text-mc-text">{stats.total}</p>
              <p className="text-xs text-mc-text-muted">Total</p>
            </div>
          </div>
        </div>
      </div>

      {/* Queue Status Detail */}
      <div className="glass-subtle overflow-hidden rounded-xl">
        <div className="border-b border-mc-border bg-mc-bg px-6 py-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-mc-text-muted">
            Queue Breakdown
          </h2>
        </div>
        <div className="divide-y divide-mc-border">
          {(["active", "deferred", "hold", "bounce"] as const).map((status) => {
            const cfg = statusConfig[status];
            const Icon = cfg.icon;
            const count = stats[status] ?? 0;
            const percentage = stats.total > 0 ? (count / stats.total) * 100 : 0;

            return (
              <div key={status} className="flex items-center gap-4 px-6 py-4">
                <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", cfg.bgColor)}>
                  <Icon className={cn("h-4 w-4", cfg.color)} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className={cn("text-sm font-medium", cfg.color)}>{cfg.label}</span>
                      <span className="ml-2 text-xs text-mc-text-muted">{cfg.description}</span>
                    </div>
                    <span className="font-mono text-sm font-bold text-mc-text">{count}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-mc-bg">
                    <div
                      className={cn("h-1.5 rounded-full transition-all duration-500", cfg.barColor)}
                      style={{ width: `${Math.max(percentage, 0)}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Empty State */}
      {isEmpty && (
        <div className="rounded-xl border border-mc-border bg-mc-surface p-12 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-mc-success/30" />
          <p className="text-sm font-medium text-mc-text">Mail queue is empty</p>
          <p className="mt-1 text-xs text-mc-text-muted">All messages have been delivered successfully.</p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-mc-text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mc-success" />
          Auto-refreshes every 5 seconds
        </span>
        <span>Data from Postfix queue</span>
      </div>

      {/* Clear Queue Dialog */}
      {showClearDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowClearDialog(false)}>
          <div className="mx-4 w-full max-w-md glass-subtle overflow-hidden rounded-xl p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-mc-danger">Clear Mail Queue</h2>
            <p className="mt-2 text-sm text-mc-text-muted">
              Are you sure you want to delete all messages from the mail queue? This action cannot be undone.
            </p>
            <div className="mt-3 rounded-lg border border-mc-danger/20 bg-mc-danger/5 p-3">
              <p className="text-sm text-mc-danger">
                {stats.total} messages will be permanently deleted.
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowClearDialog(false)}
                className="rounded-lg border border-mc-border px-4 py-2 text-sm text-mc-text-muted transition-colors hover:bg-mc-surface-hover hover:text-mc-text"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  clearMutation.mutate();
                  setShowClearDialog(false);
                }}
                disabled={clearMutation.isPending}
                className="rounded-lg bg-mc-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mc-danger/80"
              >
                {clearMutation.isPending ? "Clearing..." : "Clear All Messages"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
