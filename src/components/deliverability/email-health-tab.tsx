"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricCard } from "@/components/dashboard/metric-card";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SenderHealthRow {
  email: string;
  name: string | undefined;
  workspaceName: string;
  workspaceSlug: string;
  status: string;
  emailsSent: number;
  bounced: number;
  bounceRate: number;
  replies: number;
  replyRate: number;
  healthStatus: "healthy" | "warning" | "critical";
}

interface WorkspaceOption {
  slug: string;
  name: string;
}

interface Aggregates {
  totalSenders: number;
  connected: number;
  disconnectedCount: number;
  totalSent: number;
  totalBounced: number;
  totalReplies: number;
  avgBounceRate: number;
  avgReplyRate: number;
  highBounceCount: number;
  activeWorkspaceCount: number;
}

interface Pagination {
  currentPage: number;
  totalPages: number;
  pageSize: number;
}

interface EmailHealthData {
  senders: SenderHealthRow[];
  workspaces: WorkspaceOption[];
  failedWorkspaces: string[];
  aggregates: Aggregates;
  pagination: Pagination;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function EmailHealthSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmailHealthTab
// ---------------------------------------------------------------------------

const healthBadgeVariant = {
  healthy: "success",
  warning: "warning",
  critical: "destructive",
} as const;

export function EmailHealthTab() {
  const [data, setData] = useState<EmailHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (workspaceFilter) params.set("workspace", workspaceFilter);
      if (currentPage > 1) params.set("page", String(currentPage));
      const qs = params.toString();
      const res = await fetch(`/api/email-health${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: EmailHealthData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load email health data");
    } finally {
      setLoading(false);
    }
  }, [workspaceFilter, currentPage]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function handleWorkspaceChange(val: string) {
    setWorkspaceFilter(val === "all" ? "" : val);
    setCurrentPage(1);
  }

  if (loading) return <EmailHealthSkeleton />;

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { senders, workspaces, failedWorkspaces, aggregates, pagination } = data;
  const bounceTrend =
    aggregates.avgBounceRate > 5 ? "down" : aggregates.avgBounceRate > 2 ? "warning" : "up";

  return (
    <div className="space-y-6">
      {/* Workspace filter */}
      <div className="flex justify-end">
        <Select
          value={workspaceFilter || "all"}
          onValueChange={handleWorkspaceChange}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Workspaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Workspaces</SelectItem>
            {workspaces.map((ws) => (
              <SelectItem key={ws.slug} value={ws.slug}>
                {ws.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Alert banners */}
      {aggregates.disconnectedCount > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-medium text-red-800">
            {aggregates.disconnectedCount} inbox
            {aggregates.disconnectedCount !== 1 ? "es" : ""} disconnected —
            reconnect immediately
          </p>
        </div>
      )}

      {aggregates.highBounceCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-medium text-amber-800">
            {aggregates.highBounceCount} sender
            {aggregates.highBounceCount !== 1 ? "s" : ""} with bounce rates above
            5%
          </p>
        </div>
      )}

      {failedWorkspaces.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
          <p className="text-sm text-amber-800">
            Failed to fetch data from {failedWorkspaces.length} workspace
            {failedWorkspaces.length !== 1 ? "s" : ""}:{" "}
            {failedWorkspaces.join(", ")}. Partial data shown.
          </p>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Connected Inboxes"
          value={`${aggregates.connected}/${aggregates.totalSenders}`}
          trend={aggregates.disconnectedCount > 0 ? "down" : "up"}
          detail={
            aggregates.disconnectedCount > 0
              ? `${aggregates.disconnectedCount} disconnected`
              : "All connected"
          }
        />
        <MetricCard
          label="Avg Bounce Rate"
          value={`${aggregates.avgBounceRate.toFixed(2)}%`}
          trend={bounceTrend}
          detail={
            bounceTrend === "up"
              ? "Healthy"
              : bounceTrend === "warning"
                ? "Elevated"
                : "Critical"
          }
        />
        <MetricCard
          label="Avg Reply Rate"
          value={`${aggregates.avgReplyRate.toFixed(2)}%`}
          trend={aggregates.avgReplyRate > 1 ? "up" : "neutral"}
        />
        <MetricCard
          label="Total Emails Sent"
          value={aggregates.totalSent.toLocaleString()}
        />
      </div>

      {/* Sender Health table */}
      <div>
        <h2 className="text-base font-semibold text-foreground mb-3">
          Sender Health
        </h2>
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Bounce %</TableHead>
                <TableHead>Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {senders.map((sender) => (
                <TableRow key={`${sender.workspaceSlug}-${sender.email}`}>
                  <TableCell className="font-medium text-sm">
                    {sender.email}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {sender.workspaceName}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={`text-xs ${sender.status === "Connected" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}
                    >
                      {sender.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {sender.emailsSent.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span
                      className={
                        sender.healthStatus === "critical"
                          ? "text-red-600 font-bold"
                          : sender.healthStatus === "warning"
                            ? "text-amber-600 font-medium"
                            : ""
                      }
                    >
                      {sender.bounceRate.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={healthBadgeVariant[sender.healthStatus]}
                      className="text-xs"
                    >
                      {sender.healthStatus}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {senders.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No sender emails found across active workspaces
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing{" "}
            <span className="font-mono">
              {(pagination.currentPage - 1) * pagination.pageSize + 1}
            </span>
            &ndash;
            <span className="font-mono">
              {Math.min(
                pagination.currentPage * pagination.pageSize,
                aggregates.totalSenders,
              )}
            </span>{" "}
            of <span className="font-mono">{aggregates.totalSenders}</span>{" "}
            senders
          </p>
          <div className="flex items-center gap-2">
            {pagination.currentPage > 1 && (
              <button
                type="button"
                onClick={() => setCurrentPage((p) => p - 1)}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Previous
              </button>
            )}
            {pagination.currentPage < pagination.totalPages && (
              <button
                type="button"
                onClick={() => setCurrentPage((p) => p + 1)}
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
              >
                Next
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
