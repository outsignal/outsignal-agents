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
import { Skeleton } from "@/components/ui/skeleton";
import { INTENT_COLORS, type Intent } from "@/lib/classification/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatsResponse {
  intentDistribution: Array<{ intent: string; count: number }>;
  sentimentDistribution: Array<{ sentiment: string; count: number }>;
  workspaceCounts: Array<{ workspace: string; count: number }>;
  totalReplies: number;
  classifiedCount: number;
  unclassifiedCount: number;
  overriddenCount: number;
}

interface ReplyStatsProps {
  stats: StatsResponse | null;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Color mapping for bars (extract the bg- color to a hex)
// ---------------------------------------------------------------------------

const INTENT_BAR_COLORS: Record<string, string> = {
  interested: "#22c55e",
  meeting_booked: "#10b981",
  objection: "#ef4444",
  referral: "#3b82f6",
  not_now: "#f59e0b",
  unsubscribe: "#f43f5e",
  out_of_office: "#9ca3af",
  auto_reply: "#9ca3af",
  not_relevant: "#94a3b8",
};

const SENTIMENT_BAR_COLORS: Record<string, string> = {
  positive: "#22c55e",
  neutral: "#9ca3af",
  negative: "#ef4444",
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function StatsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-lg border p-4">
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-8 w-16 mb-2" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="rounded-lg border p-4">
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-[120px] w-full" />
      </div>
      <div className="rounded-lg border p-4">
        <Skeleton className="h-4 w-24 mb-3" />
        <Skeleton className="h-6 w-full rounded-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReplyStats({ stats, loading }: ReplyStatsProps) {
  if (loading || !stats) return <StatsSkeleton />;

  const sentimentTotal = stats.sentimentDistribution.reduce(
    (acc, s) => acc + s.count,
    0,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Total count card */}
      <div className="rounded-lg border p-4">
        <h3 className="text-xs font-medium text-muted-foreground mb-2">
          Replies
        </h3>
        <p className="text-2xl font-bold tabular-nums">
          {stats.totalReplies.toLocaleString()}
        </p>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">
              {stats.classifiedCount}
            </span>{" "}
            classified
          </span>
          <span>
            <span className="font-medium text-foreground">
              {stats.unclassifiedCount}
            </span>{" "}
            unclassified
          </span>
          {stats.overriddenCount > 0 && (
            <span>
              <span className="font-medium text-foreground">
                {stats.overriddenCount}
              </span>{" "}
              overridden
            </span>
          )}
        </div>
      </div>

      {/* Intent distribution chart */}
      <div className="rounded-lg border p-4">
        <h3 className="text-xs font-medium text-muted-foreground mb-2">
          Intent Distribution
        </h3>
        {stats.intentDistribution.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            No classified replies yet
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart
              data={stats.intentDistribution}
              layout="vertical"
              margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="intent"
                width={80}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={16}>
                {stats.intentDistribution.map((entry) => (
                  <Cell
                    key={entry.intent}
                    fill={INTENT_BAR_COLORS[entry.intent] ?? "#94a3b8"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Sentiment bar */}
      <div className="rounded-lg border p-4">
        <h3 className="text-xs font-medium text-muted-foreground mb-2">
          Sentiment
        </h3>
        {sentimentTotal === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">
            No classified replies yet
          </p>
        ) : (
          <div className="space-y-3">
            {/* Stacked bar */}
            <div className="flex h-6 w-full overflow-hidden rounded-full">
              {stats.sentimentDistribution.map((s) => {
                const pct = (s.count / sentimentTotal) * 100;
                if (pct === 0) return null;
                return (
                  <div
                    key={s.sentiment}
                    style={{
                      width: `${pct}%`,
                      backgroundColor:
                        SENTIMENT_BAR_COLORS[s.sentiment] ?? "#94a3b8",
                    }}
                    className="transition-all duration-300"
                    title={`${s.sentiment}: ${s.count} (${Math.round(pct)}%)`}
                  />
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {stats.sentimentDistribution.map((s) => (
                <div key={s.sentiment} className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{
                      backgroundColor:
                        SENTIMENT_BAR_COLORS[s.sentiment] ?? "#94a3b8",
                    }}
                  />
                  <span className="capitalize">{s.sentiment}</span>
                  <span className="font-medium text-foreground">
                    {s.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
