"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useQueryState } from "nuqs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/layout/page-shell";
import { FilterBar } from "@/components/ui/filter-bar";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ClientFilter } from "@/components/dashboard/client-filter";
import { CombinedChart, CombinedChartLegend } from "@/components/dashboard/combined-chart";
import { AlertsSection } from "@/components/dashboard/alerts-section";
import { StatusIndicatorRow } from "@/components/ui/status-indicator-row";
import { WorkspaceScorecard } from "@/components/dashboard/workspace-scorecard";
import type {
  DashboardStatsResponse,
  DashboardKPIs,
  TimeSeriesPoint,
  LinkedInTimeSeriesPoint,
  DashboardAlert,
  WorkspaceOption,
  WorkspaceSummary,
} from "@/app/api/dashboard/stats/route";

// Fallback empty KPIs
const emptyKpis: DashboardKPIs = {
  emailSent: 0,
  emailOpened: 0,
  emailReplied: 0,
  emailAutoReplied: 0,
  emailInterested: 0,
  emailBounced: 0,
  linkedinConnect: 0,
  linkedinMessage: 0,
  linkedinProfileView: 0,
  linkedinPending: 0,
  linkedinFailed: 0,
  pipelineContacted: 0,
  pipelineReplied: 0,
  pipelineInterested: 0,
  sendersHealthy: 0,
  sendersWarning: 0,
  sendersPaused: 0,
  sendersBlocked: 0,
  sendersSessionExpired: 0,
  sendersActiveTotal: 0,
  linkedinAccountsActive: 0,
  linkedinAccountsExpired: 0,
  linkedinAccountsTotal: 0,
  campaignsActive: 0,
  campaignsPaused: 0,
  campaignsCompleted: 0,
  campaignsDraft: 0,
  inboxesTotal: 0,
  inboxesHealthy: 0,
  inboxesWarning: 0,
  inboxesCritical: 0,
  workerStatus: "offline" as const,
  workerLastPollAt: null,
  sessionHealth: { active: 0, expired: 0, notSetup: 0, total: 0 },
};

// ---------------------------------------------------------------------------
// Skeleton loading state
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Alerts placeholder */}
      <Skeleton className="h-[44px] rounded-lg" />
      {/* Status row placeholder */}
      <Skeleton className="h-[44px] rounded-lg" />
      {/* Scorecard table placeholder */}
      <Skeleton className="h-[240px] rounded-lg" />
      {/* KPI cards placeholder */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="col-span-2">
          <Skeleton className="h-[140px] rounded-lg" />
        </div>
        <Skeleton className="h-[140px] rounded-lg" />
        <Skeleton className="h-[140px] rounded-lg" />
      </div>
      {/* Chart placeholder */}
      <Card>
        <CardHeader>
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[280px] rounded-lg" />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [workspace] = useQueryState("workspace", { defaultValue: "all" });
  const [days] = useQueryState("days", { defaultValue: "7" });

  const [data, setData] = useState<DashboardStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspace, days });
      const statsRes = await fetch(`/api/dashboard/stats?${params.toString()}`);
      if (statsRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
      const statsJson = (await statsRes.json()) as DashboardStatsResponse;
      setData(statsJson);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [workspace, days]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const kpis = data?.kpis ?? emptyKpis;
  const timeSeries: TimeSeriesPoint[] = data?.timeSeries ?? [];
  const linkedInTimeSeries: LinkedInTimeSeriesPoint[] = data?.linkedInTimeSeries ?? [];
  const alerts: DashboardAlert[] = data?.alerts ?? [];
  const workspaces: WorkspaceOption[] = data?.workspaces ?? [];
  const workspaceSummaries: WorkspaceSummary[] = data?.workspaceSummaries ?? [];

  const totalReplies = kpis.emailReplied + kpis.emailInterested;
  const replyRate =
    kpis.emailSent > 0
      ? ((totalReplies / kpis.emailSent) * 100).toFixed(1)
      : "\u2014";
  const bounceRate =
    kpis.emailSent > 0
      ? ((kpis.emailBounced / kpis.emailSent) * 100).toFixed(1)
      : "\u2014";

  // Derive sparkline arrays from time series for hero metrics
  const sparklineReplies = useMemo(
    () => timeSeries.map((d) => d.replies),
    [timeSeries]
  );
  const sparklineSent = useMemo(
    () => timeSeries.map((d) => d.sent),
    [timeSeries]
  );
  const sparklineLinkedin = useMemo(
    () =>
      linkedInTimeSeries.map(
        (d) => (d.connections ?? 0) + (d.messages ?? 0) + (d.profileViews ?? 0)
      ),
    [linkedInTimeSeries]
  );

  const disconnectedInboxes = kpis.inboxesWarning + kpis.inboxesCritical;
  const workerOnline = kpis.workerStatus === "online";

  const description = `${days === "7" ? "Last 7 days" : days === "14" ? "Last 14 days" : days === "30" ? "Last 30 days" : "Last 90 days"} ${workspace !== "all" ? `\u00b7 ${workspace}` : "\u00b7 all campaigns"}`;

  return (
    <PageShell title="Dashboard" description={description}>
      <FilterBar>
        <ClientFilter workspaces={workspaces} />
      </FilterBar>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <DashboardSkeleton />
      ) : !error ? (
        <>
          {/* Row 1: Alerts — promoted to top with count badge / all-clear state */}
          {alerts.length > 0 ? (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-medium text-foreground">Alerts</h3>
                <span className="inline-flex items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 text-xs font-semibold px-2 py-0.5 tabular-nums">
                  {alerts.length} {alerts.length === 1 ? "item needs" : "items need"} attention
                </span>
              </div>
              <AlertsSection alerts={alerts} />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 px-3.5 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
              <span className="inline-block size-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              <span className="font-medium">All clear</span>
              <span className="text-emerald-600/80 dark:text-emerald-400/80">— no alerts or issues detected</span>
            </div>
          )}

          {/* Row 2: System health status row */}
          <StatusIndicatorRow
            items={[
              { label: "Senders", value: `${kpis.sendersActiveTotal} active`, status: kpis.sendersActiveTotal > 0 ? "green" : "red", href: "/senders" },
              { label: "Inboxes", value: `${kpis.inboxesHealthy}/${kpis.inboxesTotal}`, status: disconnectedInboxes > 0 ? "amber" : "green", href: "/email" },
              { label: "Campaigns", value: `${kpis.campaignsActive} running`, status: kpis.campaignsActive > 0 ? "green" : "neutral" },
              { label: "Pipeline", value: `${kpis.pipelineContacted} leads`, status: "neutral", href: "/people" },
              { label: "Worker", value: workerOnline ? "Online" : "Offline", status: workerOnline ? "green" : "red" },
            ]}
          />

          {/* Row 3: Workspace scorecard table */}
          <WorkspaceScorecard summaries={workspaceSummaries} />

          {/* Row 4: Compact KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="col-span-2">
              <MetricCard
                label="Total Replies"
                value={totalReplies.toLocaleString()}
                variant="hero"
                trend={totalReplies > 0 ? "up" : "neutral"}
                detail={`${replyRate === "\u2014" ? "\u2014" : `${replyRate}%`} reply rate \u00b7 ${kpis.emailAutoReplied} auto`}
                sparklineData={sparklineReplies.length > 1 ? sparklineReplies : undefined}
                sparklineColor="#635BFF"
                density="compact"
                className="h-full"
              />
            </div>

            <MetricCard
              label="Emails Sent"
              value={kpis.emailSent.toLocaleString()}
              trend={kpis.emailSent > 0 ? "up" : "neutral"}
              detail={`${kpis.emailOpened.toLocaleString()} opened \u00b7 ${bounceRate === "\u2014" ? "\u2014" : `${bounceRate}%`} bounced`}
              sparklineData={sparklineSent.length > 1 ? sparklineSent : undefined}
              sparklineColor="#635BFF"
              density="compact"
              className="h-full"
            />

            <MetricCard
              label="LinkedIn Actions"
              value={(kpis.linkedinProfileView + kpis.linkedinConnect + kpis.linkedinMessage).toLocaleString()}
              trend={(kpis.linkedinConnect + kpis.linkedinMessage + kpis.linkedinProfileView) > 0 ? "up" : "neutral"}
              detail={`${kpis.linkedinConnect} connects \u00b7 ${kpis.linkedinMessage} messages`}
              sparklineData={sparklineLinkedin.length > 1 ? sparklineLinkedin : undefined}
              sparklineColor="#635BFF"
              density="compact"
              className="h-full"
            />
          </div>

          {/* Row 5: Activity combined chart */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Activity Overview</CardTitle>
              <CombinedChartLegend />
            </CardHeader>
            <CardContent>
              {timeSeries.length === 0 && linkedInTimeSeries.length === 0 ? (
                <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
                  No activity data for this period
                </div>
              ) : (
                <CombinedChart emailData={timeSeries} linkedInData={linkedInTimeSeries} />
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}
