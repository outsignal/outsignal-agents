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
import type {
  TimeSeriesPoint,
  LinkedInTimeSeriesPoint,
} from "@/app/api/dashboard/stats/route";

interface CombinedChartProps {
  emailData: TimeSeriesPoint[];
  linkedInData: LinkedInTimeSeriesPoint[];
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

export function CombinedChart({ emailData, linkedInData }: CombinedChartProps) {
  const mergedData = emailData.map((ep, i) => {
    const lp = linkedInData[i];
    return {
      date: ep.date,
      emailSent: ep.sent,
      linkedinActions:
        (lp?.connections ?? 0) + (lp?.messages ?? 0) + (lp?.profileViews ?? 0),
      replies: ep.replies,
      failures: ep.bounces + (lp?.failed ?? 0),
    };
  });

  const colors = {
    emailSent: "oklch(0 0 0)",                // Black
    linkedinActions: "oklch(0.6 0.17 250)",    // Blue
    replies: "oklch(0.85 0.12 110)",           // Brand green
    failures: "oklch(0.577 0.245 27.325)",     // Red
  };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart
        data={mergedData}
        margin={{ top: 4, right: 4, left: -12, bottom: 0 }}
      >
        <defs>
          <linearGradient id="gradCombinedEmailSent" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.emailSent} stopOpacity={0.08} />
            <stop offset="95%" stopColor={colors.emailSent} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradCombinedLinkedinActions" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.linkedinActions} stopOpacity={0.15} />
            <stop offset="95%" stopColor={colors.linkedinActions} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradCombinedReplies" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.replies} stopOpacity={0.2} />
            <stop offset="95%" stopColor={colors.replies} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradCombinedFailures" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.failures} stopOpacity={0.1} />
            <stop offset="95%" stopColor={colors.failures} stopOpacity={0} />
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
          dataKey="emailSent"
          name="email sent"
          stroke={colors.emailSent}
          strokeWidth={1.5}
          fill="url(#gradCombinedEmailSent)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="linkedinActions"
          name="linkedin actions"
          stroke={colors.linkedinActions}
          strokeWidth={2}
          fill="url(#gradCombinedLinkedinActions)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="replies"
          stroke={colors.replies}
          strokeWidth={2}
          fill="url(#gradCombinedReplies)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="failures"
          stroke={colors.failures}
          strokeWidth={1.5}
          fill="url(#gradCombinedFailures)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CombinedChartLegend() {
  const items = [
    { label: "Email Sent", color: "oklch(0 0 0)" },
    { label: "LinkedIn Actions", color: "oklch(0.6 0.17 250)" },
    { label: "Replies", color: "oklch(0.85 0.12 110)" },
    { label: "Failures", color: "oklch(0.577 0.245 27.325)" },
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
