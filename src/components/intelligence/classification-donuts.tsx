"use client";

import Link from "next/link";
import { PieChart as PieChartIcon, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const INTENT_COLORS: Record<string, string> = {
  interested: "#22c55e",
  meeting_booked: "#10b981",
  objection: "#ef4444",
  referral: "#3b82f6",
  not_now: "#f59e0b",
  unsubscribe: "#dc2626",
  out_of_office: "#6b7280",
  auto_reply: "#9ca3af",
  not_relevant: "#d4d4d8",
};

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "#22c55e",
  neutral: "#6b7280",
  negative: "#ef4444",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ClassificationDonutsProps {
  intentData: { intent: string; count: number }[] | null;
  sentimentData: { sentiment: string; count: number }[] | null;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number }>;
}) {
  if (!active || !payload?.[0]) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-1.5 text-xs shadow-md">
      <span className="font-medium">{payload[0].name}</span>: {payload[0].value}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ClassificationDonuts({
  intentData,
  sentimentData,
  loading,
}: ClassificationDonutsProps) {
  const hasData =
    (intentData && intentData.length > 0) ||
    (sentimentData && sentimentData.length > 0);

  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PieChartIcon className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">Reply Classification</h3>
        </div>
        <Link
          href="/inbox?view=classifications"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View details
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center gap-8 py-4">
          <Skeleton className="h-[140px] w-[140px] rounded-full" />
          <Skeleton className="h-[140px] w-[140px] rounded-full" />
        </div>
      ) : !hasData ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No classification data yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {/* Intent donut */}
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie
                  data={intentData ?? []}
                  dataKey="count"
                  nameKey="intent"
                  innerRadius={35}
                  outerRadius={55}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {(intentData ?? []).map((entry) => (
                    <Cell
                      key={entry.intent}
                      fill={INTENT_COLORS[entry.intent] ?? "#a1a1aa"}
                    />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <span className="text-xs text-muted-foreground font-medium mt-1">
              Intent
            </span>
          </div>

          {/* Sentiment donut */}
          <div className="flex flex-col items-center">
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie
                  data={sentimentData ?? []}
                  dataKey="count"
                  nameKey="sentiment"
                  innerRadius={35}
                  outerRadius={55}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {(sentimentData ?? []).map((entry) => (
                    <Cell
                      key={entry.sentiment}
                      fill={SENTIMENT_COLORS[entry.sentiment] ?? "#a1a1aa"}
                    />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <span className="text-xs text-muted-foreground font-medium mt-1">
              Sentiment
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
