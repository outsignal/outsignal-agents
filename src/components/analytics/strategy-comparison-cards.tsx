"use client";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyData {
  strategy: string;
  campaignCount: number;
  avgReplyRate: number;
  avgOpenRate: number;
  avgBounceRate: number;
  avgInterestedRate: number;
  totalSent: number;
  totalReplied: number;
  isBest: boolean;
}

interface StrategyComparisonCardsProps {
  strategies: StrategyData[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STRATEGY_LABELS: Record<string, string> = {
  "creative-ideas": "Creative Ideas",
  pvp: "PVP",
  "one-liner": "One-Liner",
  custom: "Custom",
  Unknown: "Unknown",
};

function formatStrategyName(strategy: string): string {
  return STRATEGY_LABELS[strategy] ?? strategy;
}

function formatRate(rate: number): string {
  return rate.toFixed(1);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StrategyComparisonCards({
  strategies,
}: StrategyComparisonCardsProps) {
  if (strategies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No strategy data available for this period
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {strategies.map((s) => (
        <div
          key={s.strategy}
          className={cn(
            "rounded-lg border p-4 transition-colors",
            s.isBest
              ? "border-brand-strong bg-brand/5"
              : "bg-card border-border",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold">
              {formatStrategyName(s.strategy)}
            </h4>
            {s.isBest && (
              <span className="inline-flex items-center rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground">
                Top Performer
              </span>
            )}
          </div>

          {/* Campaign count */}
          <p className="text-xs text-muted-foreground mb-2">
            {s.campaignCount} campaign{s.campaignCount !== 1 ? "s" : ""}
          </p>

          {/* Hero metric: reply rate */}
          <p className="text-3xl font-bold tabular-nums mb-3">
            {formatRate(s.avgReplyRate)}
            <span className="text-lg text-muted-foreground">%</span>
          </p>

          {/* Secondary metrics */}
          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Open rate</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatRate(s.avgOpenRate)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span>Bounce rate</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatRate(s.avgBounceRate)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span>Interested rate</span>
              <span className="font-medium text-foreground tabular-nums">
                {formatRate(s.avgInterestedRate)}%
              </span>
            </div>
          </div>

          {/* Totals */}
          <div className="mt-3 pt-3 border-t border-border/50 flex justify-between text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground tabular-nums">
                {s.totalSent.toLocaleString()}
              </span>{" "}
              sent
            </span>
            <span>
              <span className="font-medium text-foreground tabular-nums">
                {s.totalReplied.toLocaleString()}
              </span>{" "}
              replied
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
