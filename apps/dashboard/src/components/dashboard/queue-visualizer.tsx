"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueue } from "@/lib/hooks/use-queue";

interface QueueStat {
  label: string;
  count: number;
  color: string;
  bgColor: string;
}

export function QueueVisualizer() {
  const { data: queueData, isLoading } = useQueue();

  const queueStats: QueueStat[] = [
    {
      label: "Active",
      count: queueData?.active ?? 0,
      color: "text-mc-success",
      bgColor: "bg-mc-success",
    },
    {
      label: "Deferred",
      count: queueData?.deferred ?? 0,
      color: "text-mc-warning",
      bgColor: "bg-mc-warning",
    },
    {
      label: "Bounce",
      count: queueData?.bounce ?? 0,
      color: "text-mc-danger",
      bgColor: "bg-mc-danger",
    },
    {
      label: "Hold",
      count: queueData?.hold ?? 0,
      color: "text-mc-info",
      bgColor: "bg-mc-info",
    },
  ];

  const maxCount = Math.max(...queueStats.map((s) => s.count), 1);

  return (
    <div className="glass-subtle rounded-xl p-4">
      <h2 className="mb-4 text-lg font-semibold text-mc-text">Mail Queue</h2>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-mc-accent" />
        </div>
      ) : (
        <>
          {/* Stat Cards */}
          <div className="mb-6 grid grid-cols-2 gap-3">
            {queueStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-mc-border bg-mc-bg p-3"
              >
                <p className="text-[10px] uppercase tracking-wider text-mc-text-muted">
                  {stat.label}
                </p>
                <p className={cn("text-2xl font-bold", stat.color)}>
                  {stat.count}
                </p>
              </div>
            ))}
          </div>

          {/* Vertical Bar Visualization */}
          <div className="space-y-3">
            {queueStats.map((stat) => (
              <div key={stat.label}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs text-mc-text-muted">{stat.label}</span>
                  <span className={cn("text-xs font-medium", stat.color)}>
                    {stat.count}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-mc-bg">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      stat.bgColor
                    )}
                    style={{
                      width: `${maxCount > 0 ? (stat.count / maxCount) * 100 : 0}%`,
                      opacity: stat.count > 0 ? 1 : 0.2,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="mt-4 border-t border-mc-border pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-mc-text-muted">Total Queued</span>
              <span className="text-lg font-bold text-mc-text">
                {queueData?.total ?? queueStats.reduce((sum, s) => sum + s.count, 0)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
