"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepData {
  step: number;
  channel: "email" | "linkedin";
  label: string;
  sent: number;
  replied: number;
  replyRate: number;
  interestedCount: number;
  objectionCount: number;
  intentDistribution: Record<string, number>;
}

interface StepAnalyticsChartProps {
  steps: StepData[];
  campaignName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHANNEL_COLORS: Record<string, string> = {
  email: "#3b82f6",
  linkedin: "#F0FF7A",
};

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "\u2026";
}

// ---------------------------------------------------------------------------
// Intent distribution mini bar
// ---------------------------------------------------------------------------

function IntentBar({
  interestedCount,
  objectionCount,
  replied,
}: {
  interestedCount: number;
  objectionCount: number;
  replied: number;
}) {
  if (replied === 0) return null;

  const other = Math.max(0, replied - interestedCount - objectionCount);
  const intPct = (interestedCount / replied) * 100;
  const objPct = (objectionCount / replied) * 100;
  const othPct = (other / replied) * 100;

  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full mt-1">
      {intPct > 0 && (
        <div
          className="transition-all"
          style={{ width: `${intPct}%`, backgroundColor: "#22c55e" }}
          title={`Interested: ${interestedCount}`}
        />
      )}
      {objPct > 0 && (
        <div
          className="transition-all"
          style={{ width: `${objPct}%`, backgroundColor: "#ef4444" }}
          title={`Objection: ${objectionCount}`}
        />
      )}
      {othPct > 0 && (
        <div
          className="transition-all"
          style={{ width: `${othPct}%`, backgroundColor: "#9ca3af" }}
          title={`Other: ${other}`}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StepAnalyticsChart({
  steps,
  campaignName,
}: StepAnalyticsChartProps) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No step-level data available
      </p>
    );
  }

  const chartData = steps.map((s) => ({
    ...s,
    name:
      s.channel === "linkedin"
        ? `LinkedIn: ${truncate(s.label, 25)}`
        : `Step ${s.step}: ${truncate(s.label, 25)}`,
  }));

  return (
    <div className="space-y-4 py-2">
      <p className="text-xs font-medium text-muted-foreground">
        Sequence Steps &mdash; {campaignName}
      </p>

      {/* Recharts horizontal bar chart */}
      <ResponsiveContainer width="100%" height={Math.max(steps.length * 44, 80)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 60, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={200}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid var(--border)",
              backgroundColor: "var(--popover)",
              color: "var(--popover-foreground)",
            }}
            formatter={(value, _name, props) => {
              const payload = props?.payload as StepData | undefined;
              const rate = payload?.replyRate?.toFixed(1) ?? "0.0";
              return [`${value} replied (${rate}%)`, "Replies"];
            }}
          />
          <Bar dataKey="replied" radius={[0, 4, 4, 0]} maxBarSize={20}>
            {chartData.map((entry) => (
              <Cell
                key={entry.step}
                fill={CHANNEL_COLORS[entry.channel] ?? "#3b82f6"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Per-step details with intent distribution */}
      <div className="space-y-2">
        {steps.map((s) => (
          <div key={s.step} className="flex items-center gap-3">
            {/* Channel badge */}
            <span
              className={
                s.channel === "linkedin"
                  ? "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-[#F0FF7A]/20 text-[#F0FF7A] border border-[#F0FF7A]/30"
                  : "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30"
              }
            >
              {s.channel === "linkedin" ? "LinkedIn" : "Email"}
            </span>

            {/* Reply rate text */}
            <span className="text-xs tabular-nums text-muted-foreground w-12 text-right">
              {s.replyRate.toFixed(1)}%
            </span>

            {/* Intent distribution bar */}
            <div className="flex-1 max-w-[200px]">
              <IntentBar
                interestedCount={s.interestedCount}
                objectionCount={s.objectionCount}
                replied={s.replied}
              />
            </div>

            {/* Legend for this step */}
            <div className="flex gap-2 text-[10px] text-muted-foreground">
              {s.interestedCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  {s.interestedCount}
                </span>
              )}
              {s.objectionCount > 0 && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  {s.objectionCount}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          Interested
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          Objection
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-gray-400" />
          Other
        </span>
      </div>
    </div>
  );
}
