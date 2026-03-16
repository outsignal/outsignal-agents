"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (match API response shape)
// ---------------------------------------------------------------------------

interface IcpBucket {
  bucket: string;
  totalPeople: number;
  replyRate: number;
  interestedRate: number;
}

interface IcpRecommendation {
  currentThreshold: number;
  recommendedThreshold: number;
  evidence: string;
  confidence: "high" | "medium" | "low";
  sampleSize: number;
}

interface IcpCalibrationData {
  buckets: IcpBucket[];
  recommendation: IcpRecommendation | null;
  totalPeople: number;
  workspace: string | null;
  isGlobal: boolean;
}

interface IcpCalibrationSectionProps {
  data: IcpCalibrationData;
  onToggleGlobal: (global: boolean) => void;
  isGlobal: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSignalType(type: string) {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  medium:
    "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  low: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IcpCalibrationSection({
  data,
  onToggleGlobal,
  isGlobal,
}: IcpCalibrationSectionProps) {
  return (
    <div className="space-y-4">
      {/* Toggle */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => onToggleGlobal(false)}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            !isGlobal
              ? "bg-brand text-brand-foreground border-brand-strong"
              : "bg-secondary text-muted-foreground border-border hover:bg-muted",
          )}
        >
          Per Workspace
        </button>
        <button
          onClick={() => onToggleGlobal(true)}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            isGlobal
              ? "bg-brand text-brand-foreground border-brand-strong"
              : "bg-secondary text-muted-foreground border-border hover:bg-muted",
          )}
        >
          Global
        </button>
      </div>

      {/* Empty state */}
      {data.buckets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Not enough ICP data for calibration. Score more leads to see
          correlations (need 50+, currently {data.totalPeople}).
        </div>
      ) : (
        <>
          {/* Bucket bar chart */}
          <div className="rounded-lg border p-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.buckets}>
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  unit="%"
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                  formatter={(value) =>
                    typeof value === "number"
                      ? [`${value.toFixed(1)}%`]
                      : [`${value}`]
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  iconType="circle"
                  iconSize={8}
                />
                <Bar
                  dataKey="replyRate"
                  name="Reply Rate"
                  fill="hsl(215, 70%, 55%)"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="interestedRate"
                  name="Interested Rate"
                  fill="hsl(150, 60%, 45%)"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Recommendation card */}
          {data.recommendation && (
            <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">
                  ICP Threshold Recommendation
                </h4>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                    CONFIDENCE_STYLES[data.recommendation.confidence],
                  )}
                >
                  {data.recommendation.confidence} confidence
                </span>
              </div>

              {data.recommendation.currentThreshold ===
              data.recommendation.recommendedThreshold ? (
                <p className="text-sm text-muted-foreground">
                  Current threshold is well-calibrated.
                </p>
              ) : (
                <div className="flex items-center gap-2 text-lg font-bold tabular-nums">
                  <span>{data.recommendation.currentThreshold}</span>
                  <span className="text-muted-foreground text-sm">
                    &rarr;
                  </span>
                  <span className="text-brand-foreground">
                    {data.recommendation.recommendedThreshold}
                  </span>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                {data.recommendation.evidence}
              </p>
              <p className="text-[11px] text-muted-foreground/70">
                Based on {data.recommendation.sampleSize.toLocaleString()}{" "}
                scored leads
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
