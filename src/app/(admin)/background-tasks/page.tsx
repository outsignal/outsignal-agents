"use client";

import { useEffect, useState, useRef } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TriggerRun {
  id: string;
  taskIdentifier: string;
  status: string;
  tags?: string[];
  durationMs?: number | null;
  createdAt: string;
  finishedAt?: string | null;
  error?: { message?: string; name?: string } | null;
}

interface TriggerSchedule {
  id: string;
  task: string;
  active: boolean;
  generator?: { expression?: string };
  nextRun?: string | null;
}

interface TaskSummary {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  activeSchedules: number;
}

interface BackgroundTasksData {
  summary: TaskSummary;
  runs: TriggerRun[];
  schedules: TriggerSchedule[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = Math.round(seconds % 60);
  return `${minutes}m ${remainingSecs}s`;
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const FAILED_STATUSES = new Set(["FAILED", "CRASHED", "SYSTEM_FAILURE"]);
const RUNNING_STATUSES = new Set(["EXECUTING", "REATTEMPTING"]);

function StatusBadge({ status }: { status: string }) {
  if (status === "COMPLETED") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs font-medium">
        Completed
      </Badge>
    );
  }
  if (FAILED_STATUSES.has(status)) {
    const label =
      status === "CRASHED"
        ? "Crashed"
        : status === "SYSTEM_FAILURE"
          ? "System Failure"
          : "Failed";
    return (
      <Badge className="bg-red-100 text-red-800 border-red-200 text-xs font-medium">
        {label}
      </Badge>
    );
  }
  if (RUNNING_STATUSES.has(status)) {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs font-medium">
        Running
      </Badge>
    );
  }
  if (status === "REATTEMPTING") {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs font-medium">
        Retrying
      </Badge>
    );
  }
  if (status === "QUEUED") {
    return (
      <Badge className="bg-zinc-100 text-zinc-600 border-zinc-200 text-xs font-medium">
        Queued
      </Badge>
    );
  }
  if (status === "CANCELED") {
    return (
      <Badge className="bg-zinc-100 text-zinc-500 border-zinc-200 text-xs font-medium">
        Canceled
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs">
      {status}
    </Badge>
  );
}

type Period = "1d" | "7d" | "30d";

const PERIODS: { value: Period; label: string }[] = [
  { value: "1d", label: "1d" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

// Extract workspace tags from runs (exclude run IDs and empty values)
function extractWorkspaceTags(runs: TriggerRun[]): string[] {
  const tags = new Set<string>();
  for (const run of runs) {
    if (run.tags) {
      for (const tag of run.tags) {
        if (tag && !tag.startsWith("run_")) {
          tags.add(tag);
        }
      }
    }
  }
  return Array.from(tags).sort();
}

// Get first non-run_ tag as workspace label
function getWorkspaceTag(run: TriggerRun): string {
  return run.tags?.find((t) => t && !t.startsWith("run_")) ?? "-";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BackgroundTasksPage() {
  const [period, setPeriod] = useState<Period>("1d");
  const [workspace, setWorkspace] = useState<string>("all");
  const [data, setData] = useState<BackgroundTasksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ period });
    if (workspace !== "all") params.set("workspace", workspace);

    fetch(`/api/background-tasks?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<BackgroundTasksData>;
      })
      .then((json) => {
        if (active) setData(json);
      })
      .catch((err: Error) => {
        if (active) setError(err.message ?? "Failed to load data");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [period, workspace]);

  // Auto-refresh: 10s if any task is running, otherwise 30s
  useEffect(() => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }

    const hasRunning = (data?.summary.running ?? 0) > 0;
    const interval = hasRunning ? 10_000 : 30_000;

    const params = new URLSearchParams({ period });
    if (workspace !== "all") params.set("workspace", workspace);

    autoRefreshRef.current = setInterval(() => {
      fetch(`/api/background-tasks?${params.toString()}`)
        .then(async (res) => {
          if (!res.ok) return;
          return res.json() as Promise<BackgroundTasksData>;
        })
        .then((json) => {
          if (json) setData(json);
        })
        .catch(() => {
          // Silent fail on auto-refresh
        });
    }, interval);

    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
      }
    };
  }, [data?.summary.running, period, workspace]);

  const allRuns = data?.runs ?? [];
  const workspaceTags = data ? extractWorkspaceTags(data.runs) : [];

  return (
    <div>
      <Header
        title="Background Tasks"
        description="Monitor Trigger.dev task runs and schedules"
        actions={
          <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                variant="ghost"
                size="sm"
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                  period === p.value &&
                    "bg-background shadow-sm text-foreground",
                )}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="p-8 space-y-6">
        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4">
            <p className="text-sm text-red-800">
              Failed to load background task data: {error}
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
            <Skeleton className="h-48 rounded-lg" />
          </>
        )}

        {/* Loaded state */}
        {!loading && data && (
          <>
            {/* Summary metric cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Total Runs"
                value={data.summary.total.toLocaleString()}
              />
              <MetricCard
                label="Succeeded"
                value={data.summary.succeeded.toLocaleString()}
                trend={data.summary.succeeded > 0 ? "up" : "neutral"}
              />
              <MetricCard
                label="Failed"
                value={data.summary.failed.toLocaleString()}
                trend={data.summary.failed > 0 ? "down" : "neutral"}
              />
              <MetricCard
                label="Active Schedules"
                value={data.summary.activeSchedules.toLocaleString()}
              />
            </div>

            {/* Workspace filter */}
            <div className="flex items-center gap-3">
              {workspaceTags.length > 0 && (
                <Select value={workspace} onValueChange={setWorkspace}>
                  <SelectTrigger className="h-8 text-xs w-[200px]" aria-label="Filter by workspace">
                    <SelectValue placeholder="All Workspaces" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">
                      All Workspaces
                    </SelectItem>
                    {workspaceTags.map((tag) => (
                      <SelectItem key={tag} value={tag} className="text-xs font-mono">
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                Note: Scheduled tasks run globally and don&apos;t have a workspace tag.
              </p>
              {data.summary.running > 0 && (
                <Badge variant="warning" size="xs" className="ml-auto">
                  Auto-refreshing every 10s
                </Badge>
              )}
              {data.summary.running === 0 && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Auto-refreshing every 30s
                </span>
              )}
            </div>

            {/* Task runs table */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Runs</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[220px]">Task</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Finished</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allRuns.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No runs in this time range
                        </TableCell>
                      </TableRow>
                    )}
                    {allRuns.map((run) => {
                      const isFailed = FAILED_STATUSES.has(run.status);
                      const errorMsg =
                        run.error?.message ?? run.error?.name ?? null;
                      return (
                        <>
                          <TableRow key={run.id}>
                            <TableCell className="font-mono text-xs font-medium">
                              {run.taskIdentifier}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={run.status} />
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground font-mono">
                              {getWorkspaceTag(run)}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums text-muted-foreground">
                              {formatDuration(run.durationMs)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {formatRelativeTime(run.createdAt)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                              {formatRelativeTime(run.finishedAt)}
                            </TableCell>
                          </TableRow>
                          {isFailed && errorMsg && (
                            <TableRow key={`${run.id}-error`}>
                              <TableCell
                                colSpan={6}
                                className="bg-red-50 py-2 px-4 border-b border-red-100"
                              >
                                <p className="text-xs text-red-700 font-mono">
                                  <span className="font-semibold text-red-600 mr-1">
                                    Error:
                                  </span>
                                  {errorMsg}
                                </p>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Schedules section */}
            {data.schedules.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Active Schedules</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[220px]">Task</TableHead>
                        <TableHead>Schedule (cron)</TableHead>
                        <TableHead>Next Run</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.schedules.map((schedule) => (
                        <TableRow key={schedule.id}>
                          <TableCell className="font-mono text-xs font-medium">
                            {schedule.task}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {schedule.generator?.expression ?? "-"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDateTime(schedule.nextRun)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
