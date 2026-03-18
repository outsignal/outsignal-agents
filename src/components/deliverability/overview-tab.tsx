"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { DomainData } from "@/components/deliverability/domain-health-cards";

// ---------------------------------------------------------------------------
// Types (mirrors email-health-tab)
// ---------------------------------------------------------------------------

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

interface EmailHealthData {
  workspaces: WorkspaceOption[];
  failedWorkspaces: string[];
  aggregates: Aggregates;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OverviewTab
// ---------------------------------------------------------------------------

export function OverviewTab() {
  const [healthData, setHealthData] = useState<EmailHealthData | null>(null);
  const [domains, setDomains] = useState<DomainData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceFilter, setWorkspaceFilter] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (workspaceFilter) params.set("workspace", workspaceFilter);
      const qs = params.toString() ? `?${params.toString()}` : "";

      const [healthRes, domainsRes] = await Promise.allSettled([
        fetch(`/api/email-health${qs}`),
        fetch(`/api/deliverability/domains${qs}`),
      ]);

      if (healthRes.status === "fulfilled" && healthRes.value.ok) {
        const json: EmailHealthData = await healthRes.value.json();
        setHealthData(json);
      } else {
        setError("Failed to load email health data");
      }

      if (domainsRes.status === "fulfilled" && domainsRes.value.ok) {
        const json: DomainData[] = await domainsRes.value.json();
        setDomains(json);
      } else {
        setDomains([]);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load overview data",
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceFilter]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function handleWorkspaceChange(val: string) {
    setWorkspaceFilter(val === "all" ? "" : val);
  }

  if (loading) return <OverviewSkeleton />;

  if (error && !healthData) {
    return (
      <div className="rounded-md bg-destructive/10 text-destructive px-4 py-3 text-sm">
        {error}
      </div>
    );
  }

  const aggregates = healthData?.aggregates;
  const workspaces = healthData?.workspaces ?? [];
  const failedWorkspaces = healthData?.failedWorkspaces ?? [];

  // Domain health summary counts
  const domainCounts = {
    healthy: domains?.filter((d) => d.overallHealth === "healthy").length ?? 0,
    warning: domains?.filter((d) => d.overallHealth === "warning").length ?? 0,
    critical: domains?.filter((d) => d.overallHealth === "critical").length ?? 0,
  };

  const bounceTrend = aggregates
    ? aggregates.avgBounceRate > 5
      ? "down"
      : aggregates.avgBounceRate > 2
        ? "warning"
        : "up"
    : "neutral";

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
      {aggregates && aggregates.disconnectedCount > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 flex items-center justify-between dark:bg-red-950/30 dark:border-red-800">
          <p className="text-sm font-medium text-red-800 dark:text-red-300">
            {aggregates.disconnectedCount} inbox
            {aggregates.disconnectedCount !== 1 ? "es" : ""} disconnected —
            reconnect immediately
          </p>
        </div>
      )}

      {aggregates && aggregates.highBounceCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between dark:bg-amber-950/30 dark:border-amber-800">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {aggregates.highBounceCount} sender
            {aggregates.highBounceCount !== 1 ? "s" : ""} with bounce rates
            above 5%
          </p>
        </div>
      )}

      {failedWorkspaces.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:bg-amber-950/20 dark:border-amber-800">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Failed to fetch data from {failedWorkspaces.length} workspace
            {failedWorkspaces.length !== 1 ? "s" : ""}:{" "}
            {failedWorkspaces.join(", ")}. Partial data shown.
          </p>
        </div>
      )}

      {/* KPI cards */}
      {aggregates && (
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
      )}

      {/* Domain health summary */}
      {domains && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Domain Health Summary
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-emerald-500 shrink-0" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {domainCounts.healthy}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Healthy domains
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-amber-500 shrink-0" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {domainCounts.warning}
                  </p>
                  <p className="text-xs text-muted-foreground">Warning</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-500 shrink-0" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {domainCounts.critical}
                  </p>
                  <p className="text-xs text-muted-foreground">Critical</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Sender health summary */}
      {aggregates && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Sender Status
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-emerald-500 shrink-0" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {aggregates.connected}
                  </p>
                  <p className="text-xs text-muted-foreground">Connected</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-500 shrink-0" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {aggregates.disconnectedCount}
                  </p>
                  <p className="text-xs text-muted-foreground">Disconnected</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-amber-500 shrink-0" />
                <div>
                  <p className="text-2xl font-semibold tabular-nums">
                    {aggregates.highBounceCount}
                  </p>
                  <p className="text-xs text-muted-foreground">High bounce</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
