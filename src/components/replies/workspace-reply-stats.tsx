"use client";

import { cn } from "@/lib/utils";
import type { WorkspaceReplyStats } from "./types";

interface WorkspaceReplyStatsStripProps {
  stats: WorkspaceReplyStats[];
  activeWorkspace: string | null;
  onSelect: (slug: string | null) => void;
}

function sentimentHealth(s: WorkspaceReplyStats["sentiment"]): {
  color: string;
  dotColor: string;
} {
  const total = s.positive + s.neutral + s.negative;
  if (total === 0) return { color: "text-muted-foreground", dotColor: "bg-gray-400" };
  const positiveRatio = s.positive / total;
  const negativeRatio = s.negative / total;
  if (negativeRatio > 0.4)
    return { color: "text-red-600", dotColor: "bg-red-500" };
  if (positiveRatio > 0.5)
    return { color: "text-green-600", dotColor: "bg-green-500" };
  return { color: "text-amber-600", dotColor: "bg-amber-500" };
}

export function WorkspaceReplyStatsStrip({
  stats,
  activeWorkspace,
  onSelect,
}: WorkspaceReplyStatsStripProps) {
  if (stats.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
      {stats.map((ws) => {
        const isActive = activeWorkspace === ws.slug;
        const total =
          ws.sentiment.positive + ws.sentiment.neutral + ws.sentiment.negative;
        const health = sentimentHealth(ws.sentiment);

        return (
          <button
            key={ws.slug}
            onClick={() => onSelect(isActive ? null : ws.slug)}
            className={cn(
              "shrink-0 flex flex-col gap-1.5 rounded-lg border p-3 min-w-[160px] text-left transition-all duration-150",
              isActive
                ? "border-[#635BFF] bg-[#635BFF]/5 shadow-sm"
                : "border-border bg-card hover:border-[#635BFF]/30 hover:shadow-sm",
            )}
          >
            {/* Workspace name + health dot */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">{ws.name}</span>
              <span
                className={cn("h-2 w-2 rounded-full shrink-0", health.dotColor)}
                title={`Sentiment: ${health.color.includes("green") ? "healthy" : health.color.includes("red") ? "needs attention" : "moderate"}`}
              />
            </div>

            {/* Reply count */}
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-semibold tabular-nums">
                {ws.replyCount7d}
              </span>
              <span className="text-xs text-muted-foreground">replies (7d)</span>
            </div>

            {/* Sentiment mini bar */}
            {total > 0 && (
              <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-muted">
                {ws.sentiment.positive > 0 && (
                  <div
                    className="bg-green-500 transition-all"
                    style={{
                      width: `${(ws.sentiment.positive / total) * 100}%`,
                    }}
                  />
                )}
                {ws.sentiment.neutral > 0 && (
                  <div
                    className="bg-gray-400 transition-all"
                    style={{
                      width: `${(ws.sentiment.neutral / total) * 100}%`,
                    }}
                  />
                )}
                {ws.sentiment.negative > 0 && (
                  <div
                    className="bg-red-500 transition-all"
                    style={{
                      width: `${(ws.sentiment.negative / total) * 100}%`,
                    }}
                  />
                )}
              </div>
            )}

            {/* Sentiment counts */}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                {ws.sentiment.positive}
              </span>
              <span className="flex items-center gap-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                {ws.sentiment.neutral}
              </span>
              <span className="flex items-center gap-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                {ws.sentiment.negative}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
