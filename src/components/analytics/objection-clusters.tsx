"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner } from "@/components/ui/error-banner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ObjectionEntry {
  subtype: string;
  count: number;
  percentage: number;
}

interface ObjectionInsight {
  observation: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OBJECTION_COLORS: Record<string, string> = {
  budget: "#f87171",     // red-400
  timing: "#fbbf24",     // amber-400
  competitor: "#a78bfa", // violet-400
  authority: "#60a5fa",  // blue-400
  need: "#fb923c",       // orange-400
  trust: "#94a3b8",      // slate-400
};

const OBJECTION_LABELS: Record<string, string> = {
  budget: "Budget",
  timing: "Timing",
  competitor: "Competitor",
  authority: "Authority",
  need: "No Need",
  trust: "Trust",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ObjectionClustersProps {
  workspace: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ObjectionClusters({ workspace }: ObjectionClustersProps) {
  const [data, setData] = useState<ObjectionEntry[]>([]);
  const [totalObjections, setTotalObjections] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentary, setCommentary] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch objection distribution from reply stats
      const sp = new URLSearchParams();
      if (workspace) sp.set("workspace", workspace);

      const res = await fetch(`/api/replies/stats?${sp.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const distribution: { subtype: string; count: number }[] =
        json.objectionDistribution ?? [];

      const total = distribution.reduce((sum, d) => sum + d.count, 0);
      setTotalObjections(total);

      const entries: ObjectionEntry[] = distribution.map((d) => ({
        subtype: d.subtype,
        count: d.count,
        percentage: total > 0 ? Math.round((d.count / total) * 100) : 0,
      }));

      // Sort by count descending
      entries.sort((a, b) => b.count - a.count);
      setData(entries);

      // Fetch AI commentary from objection-category insights
      if (workspace) {
        try {
          const insightRes = await fetch(
            `/api/insights?workspace=${workspace}&category=objections&status=active`,
          );
          if (insightRes.ok) {
            const insights = await insightRes.json();
            if (Array.isArray(insights) && insights.length > 0) {
              setCommentary(insights[0].observation);
            } else {
              setCommentary(null);
            }
          }
        } catch {
          // Non-critical -- just skip commentary
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="rounded-lg border p-4 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorBanner
        message={`Failed to load objection data: ${error}`}
        onRetry={() => void fetchData()}
      />
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          No objection data yet. Objection subtypes are classified when replies are received.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      {/* Header stat */}
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold text-foreground">{totalObjections}</span>
        <span className="text-sm text-muted-foreground">
          total objection{totalObjections !== 1 ? "s" : ""} classified
        </span>
      </div>

      {/* Horizontal bar chart */}
      <div className="w-full" style={{ height: Math.max(data.length * 40 + 20, 120) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 70, right: 40, top: 5, bottom: 5 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
            <YAxis
              type="category"
              dataKey="subtype"
              tick={{ fontSize: 12 }}
              tickFormatter={(v: string) => OBJECTION_LABELS[v] ?? v}
              width={65}
            />
            <Tooltip
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, _name: any, props: any) => [
                `${props.payload.count} (${value}%)`,
                OBJECTION_LABELS[props.payload.subtype] ?? props.payload.subtype,
              ]}
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "6px",
                fontSize: "12px",
              }}
            />
            <Bar dataKey="percentage" radius={[0, 4, 4, 0]} barSize={20}>
              {data.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={OBJECTION_COLORS[entry.subtype] ?? "#94a3b8"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* AI Commentary */}
      <div className="border-t border-border pt-3">
        <h4 className="text-xs font-medium text-muted-foreground mb-1">
          AI Commentary
        </h4>
        <p className="text-sm text-foreground">
          {commentary
            ? commentary
            : "No AI commentary yet -- insights generate weekly."}
        </p>
      </div>
    </div>
  );
}
