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

/**
 * Standardized email activity data point.
 * All fields except `date` are optional — series with all-zero values are hidden.
 */
export interface EmailActivityPoint {
  date: string; // YYYY-MM-DD
  sent?: number;
  opens?: number;
  uniqueOpens?: number;
  replied?: number;
  bounced?: number;
  interested?: number;
  unsubscribed?: number;
}

interface Props {
  data: EmailActivityPoint[];
  height?: number;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COLORS = {
  // High-volume (left axis)
  sent: "#635BFF",              // brand purple
  opens: "oklch(0.7 0 0)",           // medium gray (unchanged)
  uniqueOpens: "oklch(0.6 0.05 250)", // slate blue (unchanged)
  // Low-volume (right axis)
  replied: "#10B981",           // green
  bounced: "#EF4444",           // red
  interested: "#F59E0B",        // amber
  unsubscribed: "#6B7280",      // gray
} as const;

type SeriesKey = keyof typeof COLORS;

const LEFT_AXIS_KEYS: SeriesKey[] = ["sent", "opens", "uniqueOpens"];
const RIGHT_AXIS_KEYS: SeriesKey[] = ["replied", "bounced", "interested", "unsubscribed"];

const LABELS: Record<SeriesKey, string> = {
  sent: "Sent",
  opens: "Opens",
  uniqueOpens: "Unique Opens",
  replied: "Replied",
  bounced: "Bounced",
  interested: "Interested",
  unsubscribed: "Unsub",
};

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  return date.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-popover-foreground mb-2">
        {formatDate(String(label ?? ""))}
      </p>
      {payload
        .filter((entry) => (entry.value ?? 0) > 0)
        .map((entry) => (
          <div key={entry.name} className="flex items-center gap-2 mb-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium text-popover-foreground ml-auto pl-3">
              {entry.value?.toLocaleString()}
            </span>
          </div>
        ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Detect which series actually have data so we can hide unused ones */
function activeSeries(data: EmailActivityPoint[]): Set<SeriesKey> {
  const active = new Set<SeriesKey>();
  for (const d of data) {
    if ((d.sent ?? 0) > 0) active.add("sent");
    if ((d.opens ?? 0) > 0) active.add("opens");
    if ((d.uniqueOpens ?? 0) > 0) active.add("uniqueOpens");
    if ((d.replied ?? 0) > 0) active.add("replied");
    if ((d.bounced ?? 0) > 0) active.add("bounced");
    if ((d.interested ?? 0) > 0) active.add("interested");
    if ((d.unsubscribed ?? 0) > 0) active.add("unsubscribed");
  }
  return active;
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

export function EmailActivityChart({ data, height = 280 }: Props) {
  const active = activeSeries(data);
  const hasRight = RIGHT_AXIS_KEYS.some((k) => active.has(k));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: hasRight ? 4 : 4, left: -12, bottom: 0 }}
      >
        <defs>
          {(Object.keys(COLORS) as SeriesKey[]).map((key) => (
            <linearGradient key={key} id={`emailGrad_${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS[key]} stopOpacity={LEFT_AXIS_KEYS.includes(key) ? 0.08 : 0.15} />
              <stop offset="95%" stopColor={COLORS[key]} stopOpacity={0} />
            </linearGradient>
          ))}
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
        {/* Left Y-axis: high-volume (Sent, Opens) */}
        <YAxis
          yAxisId="left"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tick={{ fill: "#a8a29e" }}
          allowDecimals={false}
          width={36}
        />
        {/* Right Y-axis: low-volume (Replied, Bounced, Interested, Unsubscribed) */}
        {hasRight && (
          <YAxis
            yAxisId="right"
            orientation="right"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#a8a29e" }}
            allowDecimals={false}
            width={30}
          />
        )}
        <Tooltip content={<CustomTooltip />} />

        {/* High-volume series — left axis */}
        {LEFT_AXIS_KEYS.filter((k) => active.has(k)).map((key) => (
          <Area
            key={key}
            yAxisId="left"
            type="monotone"
            dataKey={key}
            name={LABELS[key]}
            stroke={COLORS[key]}
            strokeWidth={key === "sent" ? 1.5 : 1.5}
            fill={`url(#emailGrad_${key})`}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        ))}

        {/* Low-volume series — right axis */}
        {RIGHT_AXIS_KEYS.filter((k) => active.has(k)).map((key) => (
          <Area
            key={key}
            yAxisId={hasRight ? "right" : "left"}
            type="monotone"
            dataKey={key}
            name={LABELS[key]}
            stroke={COLORS[key]}
            strokeWidth={key === "replied" ? 2 : 1.5}
            fill={key === "replied" ? `url(#emailGrad_${key})` : "transparent"}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

interface LegendProps {
  /** Only show legend items for these keys. If omitted, shows all with data. */
  keys?: SeriesKey[];
}

export function EmailActivityChartLegend({ keys }: LegendProps) {
  const items = (keys ?? (Object.keys(COLORS) as SeriesKey[])).map((key) => ({
    label: LABELS[key],
    color: COLORS[key],
  }));

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
