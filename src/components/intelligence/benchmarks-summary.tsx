"use client";

import Link from "next/link";
import { Gauge, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ReferenceGauge } from "@/components/analytics/reference-band-gauge";
import type { IndustryBenchmark } from "@/lib/analytics/industry-benchmarks";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BenchmarksData {
  workspace: string;
  metrics: Record<string, number>;
  globalAvg: Record<string, number>;
  industry: Record<string, IndustryBenchmark>;
}

interface BenchmarksSummaryProps {
  data: BenchmarksData | null;
  loading: boolean;
  hasWorkspace: boolean;
}

// ---------------------------------------------------------------------------
// Metrics to display
// ---------------------------------------------------------------------------

const GAUGE_METRICS = [
  { key: "replyRate", label: "Reply Rate" },
  { key: "openRate", label: "Open Rate" },
  { key: "interestedRate", label: "Interested Rate" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BenchmarksSummary({
  data,
  loading,
  hasWorkspace,
}: BenchmarksSummaryProps) {
  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">Benchmarks</h3>
        </div>
        <Link
          href="/analytics?tab=benchmarks"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View details
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Content */}
      {!hasWorkspace ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Select a workspace to see benchmarks
        </p>
      ) : loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No benchmark data available.
        </p>
      ) : (
        <div className="space-y-4">
          {GAUGE_METRICS.map(({ key, label }) => (
            <ReferenceGauge
              key={key}
              label={label}
              value={data.metrics[key] ?? 0}
              globalAvg={data.globalAvg[key] ?? 0}
              industry={
                data.industry[key] ?? { low: 1, avg: 3, high: 6 }
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
