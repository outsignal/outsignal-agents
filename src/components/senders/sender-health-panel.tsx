"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface SenderHealthPanelProps {
  senderId: string;
  isExpanded: boolean;
}

interface HealthEvent {
  id: string;
  status: string;
  reason: string;
  detail: string | null;
  bouncePct: number | null;
  createdAt: string;
}

interface SparklinePoint {
  date: string;
  statusNum: number;
}

interface HealthSummary {
  currentStatus: string;
  lastFlagReason: string | null;
  flagCount: number;
  daysSinceLastIncident: number | null;
}

interface HealthHistoryResponse {
  events: HealthEvent[];
  sparkline: SparklinePoint[];
  summary: HealthSummary;
}

const STATUS_BADGE_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  healthy: "success",
  warning: "warning",
  paused: "warning",
  blocked: "destructive",
  session_expired: "destructive",
};

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return "just now";
}

function formatReasonLabel(reason: string): string {
  return reason.replace(/_/g, " ");
}

export function SenderHealthPanel({ senderId, isExpanded }: SenderHealthPanelProps) {
  const [data, setData] = useState<HealthHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isExpanded) return;

    setLoading(true);
    setError(null);

    fetch(`/api/senders/${senderId}/health-history`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HealthHistoryResponse>;
      })
      .then((json) => {
        setData(json);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load health history");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isExpanded, senderId]);

  if (!isExpanded) return null;

  if (loading) {
    return (
      <div className="space-y-2 px-4 py-3 border-t border-border/50">
        <Skeleton className="h-12 w-full" />
        <div className="flex gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="space-y-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 border-t border-border/50">
        <p className="text-xs text-destructive">Failed to load health history</p>
      </div>
    );
  }

  if (!data) return null;

  const { sparkline, summary, events } = data;

  // Determine sparkline color from latest data point
  const latestStatusNum = sparkline[sparkline.length - 1]?.statusNum ?? 0;
  const sparklineColor =
    latestStatusNum === 0 ? "oklch(0.723 0.219 142.136)" : latestStatusNum === 1 ? "oklch(0.795 0.184 86.047)" : "oklch(0.637 0.237 25.331)";

  return (
    <div className="border-t border-border/50 px-4 pt-3 pb-2 space-y-3">
      {/* Sparkline */}
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          30-day health trend
        </p>
        {sparkline.length > 0 ? (
          <ResponsiveContainer width="100%" height={48}>
            <LineChart data={sparkline} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
              <Line
                type="stepAfter"
                dataKey="statusNum"
                stroke={sparklineColor}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-12 flex items-center">
            <span className="text-xs text-muted-foreground">No data</span>
          </div>
        )}
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[10px] text-muted-foreground">Flags (30d)</p>
          <p className="text-xs font-medium">{summary.flagCount}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Days since incident</p>
          <p className="text-xs font-medium">
            {summary.daysSinceLastIncident !== null ? summary.daysSinceLastIncident : "None"}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Last reason</p>
          <p className="text-xs font-medium truncate">
            {summary.lastFlagReason
              ? formatReasonLabel(summary.lastFlagReason)
              : "None"}
          </p>
        </div>
      </div>

      {/* Recent event list */}
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">No health events recorded</p>
      ) : (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Recent events
          </p>
          {events.map((event) => (
            <div key={event.id} className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground w-10 shrink-0 text-[10px]">
                {formatRelativeTime(event.createdAt)}
              </span>
              <Badge
                variant={STATUS_BADGE_VARIANT[event.status] ?? "secondary"}
                className="text-[9px] px-1.5 py-0 shrink-0"
              >
                {event.status.replace("_", " ")}
              </Badge>
              <span className="text-muted-foreground truncate text-[10px]">
                {formatReasonLabel(event.reason)}
                {event.detail ? ` — ${event.detail}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
