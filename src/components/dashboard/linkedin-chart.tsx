"use client";

import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import type { LinkedInTimeSeriesPoint } from "@/app/api/dashboard/stats/route";

interface LinkedInChartProps {
  data: LinkedInTimeSeriesPoint[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  return date.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-popover-foreground mb-2">
        {formatDate(String(label ?? ""))}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 mb-1">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground capitalize">{entry.name}:</span>
          <span className="font-medium text-popover-foreground ml-auto pl-3">
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export function LinkedInChart({ data }: LinkedInChartProps) {
  const colors = {
    connections: "oklch(0.6 0.17 250)",    // Blue
    messages: "oklch(0.85 0.12 110)",      // Brand accent green
    profileViews: "oklch(0.7 0 0)",        // Medium gray
    failed: "oklch(0.577 0.245 27.325)",   // Red/destructive
  };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: 4, left: -12, bottom: 0 }}
      >
        <defs>
          <linearGradient id="gradConnections" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.connections} stopOpacity={0.15} />
            <stop offset="95%" stopColor={colors.connections} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradMessages" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.messages} stopOpacity={0.2} />
            <stop offset="95%" stopColor={colors.messages} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradProfileViews" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.profileViews} stopOpacity={0.08} />
            <stop offset="95%" stopColor={colors.profileViews} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.failed} stopOpacity={0.1} />
            <stop offset="95%" stopColor={colors.failed} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="oklch(0.92 0 0)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatDate}
          tick={{ fill: "#a8a29e" }}
          interval="preserveStartEnd"
        />
        <YAxis
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "#a8a29e" }}
          allowDecimals={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="connections"
          stroke={colors.connections}
          strokeWidth={2}
          fill="url(#gradConnections)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="messages"
          stroke={colors.messages}
          strokeWidth={2}
          fill="url(#gradMessages)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="profileViews"
          name="profile views"
          stroke={colors.profileViews}
          strokeWidth={1.5}
          fill="url(#gradProfileViews)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="failed"
          stroke={colors.failed}
          strokeWidth={1.5}
          fill="url(#gradFailed)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function LinkedInChartLegend() {
  const items = [
    { label: "Connections", color: "oklch(0.6 0.17 250)" },
    { label: "Messages", color: "oklch(0.85 0.12 110)" },
    { label: "Profile Views", color: "oklch(0.7 0 0)" },
    { label: "Failed", color: "oklch(0.577 0.245 27.325)" },
  ];

  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span
            className="inline-block w-3 h-0.5 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </div>
      ))}
    </div>
  );
}
