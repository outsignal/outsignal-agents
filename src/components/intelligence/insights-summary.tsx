"use client";

import Link from "next/link";
import { Lightbulb, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightCard } from "@/components/analytics/insight-card";

// ---------------------------------------------------------------------------
// Types — matches shape from insight-card.tsx / insights API
// ---------------------------------------------------------------------------

interface EvidenceItem {
  metric: string;
  value: string;
  change: string | null;
}

export interface InsightData {
  id: string;
  category: "performance" | "copy" | "objections" | "icp";
  observation: string;
  evidence: EvidenceItem[];
  actionType: "pause_campaign" | "update_icp_threshold" | "flag_copy_review" | "adjust_signal_targeting";
  actionDescription: string;
  actionParams: Record<string, string> | null;
  confidence: "high" | "medium" | "low";
  priority: number;
  status: "active" | "approved" | "dismissed" | "snoozed" | "executed" | "failed";
  generatedAt: string;
  executionResult: {
    before?: string;
    after?: string;
    outcome?: string;
    error?: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InsightsSummaryProps {
  insights: InsightData[] | null;
  loading: boolean;
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InsightsSummary({
  insights,
  loading,
  onRefresh,
}: InsightsSummaryProps) {
  const activeInsights = insights
    ?.filter((i) => i.status === "active")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 3);

  const activeCount = insights?.filter((i) => i.status === "active").length ?? 0;

  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">Active Insights</h3>
          {!loading && activeCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-semibold">
              {activeCount}
            </span>
          )}
        </div>
        <Link
          href="/analytics?tab=insights"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View details
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : !activeInsights || activeInsights.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No active insights. Check back after the next weekly analysis.
        </p>
      ) : (
        <div className="space-y-3">
          {activeInsights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onAction={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
