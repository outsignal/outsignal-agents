"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Summary {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  failureRate: number;
}

interface TypeRow {
  notificationType: string;
  label: string;
  channels: string;
  audience: string;
  total: number;
  sent: number;
  failed: number;
  lastFiredAt: string | null;
  status: "green" | "amber" | "red" | "neutral";
}

interface FailureRow {
  id: string;
  notificationType: string;
  channel: string;
  recipient: string | null;
  errorMessage: string | null;
  workspaceSlug: string | null;
  createdAt: string;
}

interface HealthData {
  summary: Summary;
  byType: TypeRow[];
  recentFailures: FailureRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function timeAgo(date: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000,
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusDot({ status }: { status: string }) {
  if (status === "green") {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
    );
  }
  if (status === "red") {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
    );
  }
  if (status === "amber") {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
      </span>
    );
  }
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-zinc-400" />
    </span>
  );
}

const STATUS_SORT_ORDER: Record<string, number> = {
  red: 0,
  amber: 1,
  green: 2,
  neutral: 3,
};

type Range = "24h" | "7d" | "30d";

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NotificationHealthPage() {
  const [range, setRange] = useState<Range>("24h");
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    function fetchData(showLoading = true) {
      if (showLoading) {
        setLoading(true);
        setError(null);
      }

      fetch(`/api/notification-health?range=${range}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json: HealthData) => {
          if (active) {
            json.byType.sort(
              (a, b) =>
                (STATUS_SORT_ORDER[a.status] ?? 3) -
                (STATUS_SORT_ORDER[b.status] ?? 3),
            );
            setData(json);
            setError(null);
          }
        })
        .catch((err) => {
          if (active) setError(err.message ?? "Failed to load data");
        })
        .finally(() => {
          if (active && showLoading) setLoading(false);
        });
    }

    fetchData(true);

    const interval = setInterval(() => fetchData(false), 60_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [range]);

  return (
    <div>
      <Header
        title="Notification Health"
        description="Monitor notification delivery across all channels"
        actions={
          <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
            {RANGES.map((r) => (
              <Button
                key={r.value}
                variant="ghost"
                size="sm"
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  range === r.value &&
                    "bg-background shadow-sm text-foreground",
                )}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="p-6 space-y-6">
        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">
              Failed to load notification health data: {error}
            </p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-64 rounded-lg" />
            <Skeleton className="h-64 rounded-lg" />
          </>
        )}

        {/* Loaded state */}
        {!loading && data && (
          <>
            {/* Summary metric cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Total Sent"
                value={data.summary.sent.toLocaleString()}
                trend={data.summary.sent > 0 ? "up" : "neutral"}
              />
              <MetricCard
                label="Failed"
                value={data.summary.failed.toLocaleString()}
                trend={data.summary.failed > 0 ? "down" : "neutral"}
              />
              <MetricCard
                label="Failure Rate"
                value={`${data.summary.failureRate}%`}
                trend={
                  data.summary.failureRate > 20
                    ? "down"
                    : data.summary.failureRate > 5
                      ? "warning"
                      : "neutral"
                }
              />
              <MetricCard
                label="Skipped"
                value={data.summary.skipped.toLocaleString()}
              />
            </div>

            {/* Status by Type table */}
            <Card>
              <CardHeader>
                <CardTitle>Notification Types</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[220px]">Type</TableHead>
                      <TableHead>Channels</TableHead>
                      <TableHead>Audience</TableHead>
                      <TableHead>Last Fired</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byType.map((row) => (
                      <TableRow key={row.notificationType}>
                        <TableCell className="font-medium text-sm">
                          <div className="flex items-center gap-2.5">
                            <StatusDot status={row.status} />
                            {row.label}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.channels}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.audience}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.lastFiredAt ? timeAgo(row.lastFiredAt) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.sent.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.failed.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Recent Failures table */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Failures</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>Workspace</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.recentFailures.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {timeAgo(row.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatType(row.notificationType)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" size="xs">
                            {row.channel}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className="text-sm max-w-[160px] truncate"
                          title={row.recipient ?? ""}
                        >
                          {row.recipient ?? "-"}
                        </TableCell>
                        <TableCell
                          className="text-sm text-destructive max-w-[240px] truncate"
                          title={row.errorMessage ?? ""}
                        >
                          {row.errorMessage ?? "-"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {row.workspaceSlug ?? "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.recentFailures.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No failures in this time range
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
