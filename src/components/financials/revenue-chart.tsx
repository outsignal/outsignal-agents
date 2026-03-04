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
import { formatGBP } from "@/lib/invoices/format";

interface RevenueDataPoint {
  month: string; // "YYYY-MM"
  revenuePence: number;
}

interface RevenueChartProps {
  data: RevenueDataPoint[];
}

// Format "YYYY-MM" to "Jan", "Feb", etc.
function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1, 1);
  return date.toLocaleDateString("en-GB", { month: "short" });
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

  const pence = payload[0]?.value ?? 0;

  return (
    <div className="bg-popover border border-border rounded-md shadow-md p-3 text-xs">
      <p className="font-medium text-popover-foreground mb-2">
        {formatMonth(String(label ?? ""))}
      </p>
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: payload[0]?.color }}
        />
        <span className="text-muted-foreground">Revenue:</span>
        <span className="font-medium text-popover-foreground ml-auto pl-3">
          {formatGBP(pence)}
        </span>
      </div>
    </div>
  );
};

export function RevenueChart({ data }: RevenueChartProps) {
  // Brand color — oklch brand accent (darker shade for chart contrast)
  const revenueColor = "oklch(0.75 0.18 110)"; // brand yellow-green

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
      >
        <defs>
          <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={revenueColor} stopOpacity={0.25} />
            <stop offset="95%" stopColor={revenueColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="oklch(0.92 0 0)"
          vertical={false}
        />
        <XAxis
          dataKey="month"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatMonth}
          tick={{ fill: "oklch(0.45 0 0)" }}
          interval="preserveStartEnd"
        />
        <YAxis
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "oklch(0.45 0 0)" }}
          tickFormatter={(v: number) => `£${(v / 100).toLocaleString("en-GB")}`}
          width={56}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="revenuePence"
          stroke={revenueColor}
          strokeWidth={2}
          fill="url(#gradRevenue)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
