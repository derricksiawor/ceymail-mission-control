"use client";

import { Loader2 } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useStats, useStatsHistory } from "@/lib/hooks/use-stats";

const chartConfig = [
  {
    title: "CPU Usage",
    dataKey: "cpu",
    color: "#3b82f6",
    gradientId: "cpuGradient",
    unit: "%",
  },
  {
    title: "Memory Usage",
    dataKey: "memory",
    color: "#22c55e",
    gradientId: "memGradient",
    unit: "%",
  },
  {
    title: "Disk Usage",
    dataKey: "disk",
    color: "#f59e0b",
    gradientId: "diskGradient",
    unit: "%",
  },
];

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
  unit: string;
}

function CustomTooltip({ active, payload, label, unit }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="glass rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-mc-text-muted">{label}</p>
      <p className="text-sm font-semibold text-mc-text">
        {payload[0].value.toFixed(1)}
        {unit}
      </p>
    </div>
  );
}

export function SystemCharts() {
  const { data: history, isLoading } = useStatsHistory();

  const chartData = (history ?? []).map((snap) => ({
    time: new Date(snap.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    cpu: snap.cpu_percent,
    memory: snap.memory_used_bytes > 0 ? (snap.memory_used_bytes / 4294967296) * 100 : 0,
    disk: snap.disk_used_bytes > 0 ? (snap.disk_used_bytes / 107374182400) * 100 : 0,
  }));

  return (
    <div className="glass-subtle rounded-xl p-4">
      <h2 className="mb-4 text-lg font-semibold text-mc-text">
        System Metrics
      </h2>
      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-mc-accent" />
        </div>
      ) : chartData.length === 0 ? (
        <p className="py-10 text-center text-sm text-mc-text-muted">
          No metric history available yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {chartConfig.map((chart) => (
            <div key={chart.dataKey}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-mc-text-muted">
                {chart.title}
              </h3>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id={chart.gradientId}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={chart.color}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor={chart.color}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#1e293b"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      content={<CustomTooltip unit={chart.unit} />}
                    />
                    <Area
                      type="monotone"
                      dataKey={chart.dataKey}
                      stroke={chart.color}
                      strokeWidth={2}
                      fill={`url(#${chart.gradientId})`}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
