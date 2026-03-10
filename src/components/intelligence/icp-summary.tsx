"use client";

import Link from "next/link";
import { UserCheck, ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface IcpBucket {
  bucket: string;
  totalSent: number;
  replyRate: number;
  interestedRate: number;
}

interface IcpRecommendation {
  current: number;
  suggested: number;
  confidence: string;
  reason: string;
}

interface IcpSummaryProps {
  buckets: IcpBucket[] | null;
  recommendation: IcpRecommendation | null;
  loading: boolean;
}

// ---------------------------------------------------------------------------
// Confidence badge colors
// ---------------------------------------------------------------------------

const CONFIDENCE_BADGE: Record<string, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-600",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IcpSummary({
  buckets,
  recommendation,
  loading,
}: IcpSummaryProps) {
  return (
    <div className="rounded-lg border bg-card/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-muted-foreground" />
          <h3 className="font-semibold">ICP Calibration</h3>
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
      {loading ? (
        <Skeleton className="h-[140px] w-full" />
      ) : !buckets || buckets.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          Not enough data for ICP calibration.
        </p>
      ) : (
        <>
          {/* Bar chart */}
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                formatter={(value) => [`${Number(value ?? 0).toFixed(1)}%`, "Reply Rate"]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--popover)",
                }}
              />
              <Bar
                dataKey="replyRate"
                fill="#3b82f6"
                radius={[3, 3, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ResponsiveContainer>

          {/* Recommendation card */}
          {recommendation && (
            <div className="rounded-md bg-muted/50 px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">
                  Adjust threshold from {recommendation.current} to{" "}
                  {recommendation.suggested}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    CONFIDENCE_BADGE[recommendation.confidence] ?? CONFIDENCE_BADGE.low
                  }`}
                >
                  {recommendation.confidence}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                {recommendation.reason}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
