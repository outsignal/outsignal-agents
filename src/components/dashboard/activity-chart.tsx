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
import type { TimeSeriesPoint } from "@/app/api/dashboard/stats/route";

interface ActivityChartProps {
  data: TimeSeriesPoint[];
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
    <div className="bg-popover border border-border rounded-md shadow-md p-3 text-xs">
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

export function ActivityChart({ data }: ActivityChartProps) {
  // Recharts requires raw color values — these mirror the CSS variables from globals.css
  const colors = {
    sent: "oklch(0 0 0)",            // --chart-2 / black
    replies: "oklch(0.85 0.12 110)", // --chart-5 / brand accent (darker for contrast)
    bounces: "oklch(0.577 0.245 27.325)", // --destructive / red
    opens: "oklch(0.7 0 0)",         // --chart-4 / medium gray
  };

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: 4, left: -12, bottom: 0 }}
      >
        <defs>
          <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.sent} stopOpacity={0.08} />
            <stop offset="95%" stopColor={colors.sent} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradReplies" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.replies} stopOpacity={0.2} />
            <stop offset="95%" stopColor={colors.replies} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradBounces" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.bounces} stopOpacity={0.1} />
            <stop offset="95%" stopColor={colors.bounces} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradOpens" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.opens} stopOpacity={0.08} />
            <stop offset="95%" stopColor={colors.opens} stopOpacity={0} />
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
          tick={{ fill: "oklch(0.45 0 0)" }}
          interval="preserveStartEnd"
        />
        <YAxis
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "oklch(0.45 0 0)" }}
          allowDecimals={false}
          width={36}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="sent"
          stroke={colors.sent}
          strokeWidth={1.5}
          fill="url(#gradSent)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="replies"
          stroke={colors.replies}
          strokeWidth={2}
          fill="url(#gradReplies)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="bounces"
          stroke={colors.bounces}
          strokeWidth={1.5}
          fill="url(#gradBounces)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="opens"
          stroke={colors.opens}
          strokeWidth={1.5}
          fill="url(#gradOpens)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Legend for the chart
export function ActivityChartLegend() {
  const items = [
    { label: "Sent", color: "oklch(0 0 0)" },
    { label: "Replies", color: "oklch(0.85 0.12 110)" },
    { label: "Bounces", color: "oklch(0.577 0.245 27.325)" },
    { label: "Opens", color: "oklch(0.7 0 0)" },
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
