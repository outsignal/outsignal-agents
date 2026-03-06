"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useQueryState } from "nuqs";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ClientFilter } from "@/components/dashboard/client-filter";
import { ActivityChart, ActivityChartLegend } from "@/components/dashboard/activity-chart";
import { LinkedInChart, LinkedInChartLegend } from "@/components/dashboard/linkedin-chart";
import { CombinedChart, CombinedChartLegend } from "@/components/dashboard/combined-chart";
import { CollapsibleSection } from "@/components/dashboard/collapsible-section";
import { AlertsSection } from "@/components/dashboard/alerts-section";
import {
  OverviewTable,
  type WorkspaceSummary,
} from "@/components/dashboard/overview-table";
import type {
  DashboardStatsResponse,
  DashboardKPIs,
  TimeSeriesPoint,
  LinkedInTimeSeriesPoint,
  DashboardAlert,
  WorkspaceOption,
} from "@/app/api/dashboard/stats/route";

// Fallback empty KPIs
const emptyKpis: DashboardKPIs = {
  emailSent: 0,
  emailOpened: 0,
  emailReplied: 0,
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
  campaignsDraft: 0,
  inboxesConnected: 0,
  inboxesDisconnected: 0,
  workerOnline: false,
  workerLastPollAt: null,
};

function buildWorkspaceSummaries(
  workspaces: WorkspaceOption[],
  kpis: DashboardKPIs
): WorkspaceSummary[] {
  return workspaces.map((ws) => ({
    slug: ws.slug,
    name: ws.name,
    activeCampaigns: 0,
    totalLeads: 0,
    replyRate: 0,
    bounceRate: 0,
    flaggedSenders: 0,
  }));
}

function KpiSkeleton() {
  return <Skeleton className="h-[88px] rounded-lg" />;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Health row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <KpiSkeleton key={i} />
        ))}
      </div>
      {/* Combined chart */}
      <Card>
        <CardHeader>
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] rounded-lg" />
        </CardContent>
      </Card>
      {/* Collapsible section skeletons */}
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 rounded-lg" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [workspace] = useQueryState("workspace", { defaultValue: "all" });
  const [days] = useQueryState("days", { defaultValue: "7" });

  const [data, setData] = useState<DashboardStatsResponse | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [signalsData, setSignalsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspace, days });
      const [statsRes, signalsRes] = await Promise.all([
        fetch(`/api/dashboard/stats?${params.toString()}`),
        fetch(`/api/signals?workspace=${workspace}&limit=20`),
      ]);
      if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
      const statsJson = (await statsRes.json()) as DashboardStatsResponse;
      setData(statsJson);

      if (signalsRes.ok) {
        const signalsJson = await signalsRes.json();
        setSignalsData(signalsJson);
      }
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

  const totalReplies = kpis.emailReplied + kpis.emailInterested;
  const replyRate =
    kpis.emailSent > 0
      ? ((totalReplies / kpis.emailSent) * 100).toFixed(1)
      : "—";
  const bounceRate =
    kpis.emailSent > 0
      ? ((kpis.emailBounced / kpis.emailSent) * 100).toFixed(1)
      : "—";

  return (
    <div>
      {/* Header */}
      <Header
        title="Dashboard"
        description={`${days === "7" ? "Last 7 days" : days === "14" ? "Last 14 days" : days === "30" ? "Last 30 days" : "Last 90 days"} ${workspace !== "all" ? `· ${workspace}` : "· all campaigns"}`}
        actions={<ClientFilter workspaces={workspaces} />}
      />

      <div className="p-6 space-y-6">
        {/* Alerts */}
        {!loading && alerts.length > 0 && (
          <AlertsSection alerts={alerts} />
        )}

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <DashboardSkeleton />
        ) : !error ? (
          <>
            {/* Section 1: Health & Alerts */}
            {(() => {
              const workerDetail = kpis.workerLastPollAt
                ? `Last poll ${(() => {
                    const mins = Math.round((Date.now() - new Date(kpis.workerLastPollAt).getTime()) / 60000);
                    if (mins < 1) return "just now";
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.round(mins / 60);
                    return `${hrs}h ago`;
                  })()}`
                : "Never polled";

              return (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <Link href="/senders" className="block">
                    <MetricCard
                      label="Senders"
                      value={`${kpis.linkedinAccountsActive} active`}
                      trend={kpis.linkedinAccountsExpired > 0 ? "warning" : kpis.linkedinAccountsActive > 0 ? "up" : "neutral"}
                      detail={`${kpis.linkedinAccountsTotal} total${kpis.linkedinAccountsExpired > 0 ? ` · ${kpis.linkedinAccountsExpired} expired` : ""}`}
                      density="compact"
                    />
                  </Link>
                  <MetricCard
                    label="Inboxes"
                    value={`${kpis.inboxesConnected} connected`}
                    trend={kpis.inboxesDisconnected > 0 ? "warning" : "up"}
                    detail={`${kpis.inboxesConnected + kpis.inboxesDisconnected} total${kpis.inboxesDisconnected > 0 ? ` · ${kpis.inboxesDisconnected} disconnected` : ""}${Number(bounceRate) > 5 ? ` · ${bounceRate}% bounce` : ""}`}
                    density="compact"
                  />
                  <MetricCard
                    label="Campaigns"
                    value={`${kpis.campaignsActive + kpis.campaignsPaused + kpis.campaignsDraft} total`}
                    trend={kpis.campaignsActive > 0 ? "up" : "neutral"}
                    detail={`${kpis.campaignsActive} active · ${kpis.campaignsPaused} paused · ${kpis.campaignsDraft} draft`}
                    density="compact"
                  />
                  <MetricCard
                    label="Emails"
                    value={kpis.emailSent.toLocaleString() + " sent"}
                    trend={kpis.emailBounced > 0 ? "warning" : kpis.emailSent > 0 ? "up" : "neutral"}
                    detail={`${kpis.emailBounced.toLocaleString()} bounced · ${kpis.emailReplied.toLocaleString()} replies`}
                    density="compact"
                  />
                  <MetricCard
                    label="LinkedIn"
                    value={`${(kpis.linkedinProfileView + kpis.linkedinConnect + kpis.linkedinMessage).toLocaleString()} actions`}
                    trend={kpis.linkedinFailed > 0 ? "warning" : (kpis.linkedinConnect + kpis.linkedinMessage + kpis.linkedinProfileView) > 0 ? "up" : "neutral"}
                    detail={`${kpis.linkedinProfileView} views · ${kpis.linkedinConnect} connects · ${kpis.linkedinMessage} messages`}
                    density="compact"
                  />
                  <MetricCard
                    label="Worker"
                    value={kpis.workerOnline ? "Online" : "Offline"}
                    trend={kpis.workerOnline ? "up" : "down"}
                    detail={workerDetail}
                    density="compact"
                  />
                </div>
              );
            })()}

            {/* Section 2: Combined Activity Chart */}
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Activity Overview</CardTitle>
                <CombinedChartLegend />
              </CardHeader>
              <CardContent>
                {timeSeries.length === 0 && linkedInTimeSeries.length === 0 ? (
                  <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                    No activity data for this period
                  </div>
                ) : (
                  <CombinedChart emailData={timeSeries} linkedInData={linkedInTimeSeries} />
                )}
              </CardContent>
            </Card>

            {/* Section 3: Email (collapsible, default open) */}
            <CollapsibleSection
              id="email"
              title="Email"
              collapsedSummary={
                <span className="text-xs text-muted-foreground">
                  {kpis.emailSent.toLocaleString()} sent · {replyRate === "—" ? "—" : `${replyRate}%`} reply rate
                </span>
              }
              actions={<ActivityChartLegend />}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MetricCard
                    label="Reply Rate"
                    value={replyRate === "—" ? "—" : `${replyRate}%`}
                    trend={Number(replyRate) > 0 ? "up" : "neutral"}
                    detail={`${totalReplies.toLocaleString()} replies from ${kpis.emailSent.toLocaleString()} sent`}
                    density="compact"
                    featured
                  />
                  <MetricCard
                    label="Emails Sent"
                    value={kpis.emailSent.toLocaleString()}
                    trend="neutral"
                    density="compact"
                  />
                  <MetricCard
                    label="Opened"
                    value={kpis.emailOpened.toLocaleString()}
                    trend="neutral"
                    detail={
                      kpis.emailSent > 0
                        ? `${((kpis.emailOpened / kpis.emailSent) * 100).toFixed(1)}% open rate`
                        : undefined
                    }
                    density="compact"
                  />
                  <MetricCard
                    label="Bounces"
                    value={kpis.emailBounced.toLocaleString()}
                    trend={kpis.emailBounced > 0 ? "down" : "neutral"}
                    detail={`${bounceRate}% bounce rate`}
                    density="compact"
                  />
                </div>
                {timeSeries.length === 0 ? (
                  <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                    No email activity for this period
                  </div>
                ) : (
                  <ActivityChart data={timeSeries} />
                )}
              </div>
            </CollapsibleSection>

            {/* Section 4: LinkedIn (collapsible, default open) */}
            <CollapsibleSection
              id="linkedin"
              title="LinkedIn"
              collapsedSummary={
                <span className="text-xs text-muted-foreground">
                  {(kpis.linkedinConnect + kpis.linkedinMessage + kpis.linkedinProfileView).toLocaleString()} actions · {kpis.linkedinConnect.toLocaleString()} connections
                </span>
              }
              actions={<LinkedInChartLegend />}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <MetricCard
                    label="Profile Views"
                    value={kpis.linkedinProfileView.toLocaleString()}
                    trend={kpis.linkedinProfileView > 0 ? "up" : "neutral"}
                    density="compact"
                  />
                  <MetricCard
                    label="Connections Sent"
                    value={kpis.linkedinConnect.toLocaleString()}
                    trend={kpis.linkedinConnect > 0 ? "up" : "neutral"}
                    detail={`${kpis.linkedinPending} pending`}
                    density="compact"
                  />
                  <MetricCard
                    label="Messages Sent"
                    value={kpis.linkedinMessage.toLocaleString()}
                    trend={kpis.linkedinMessage > 0 ? "up" : "neutral"}
                    density="compact"
                  />
                  <MetricCard
                    label="Failed Actions"
                    value={kpis.linkedinFailed.toLocaleString()}
                    trend={kpis.linkedinFailed > 0 ? "warning" : "neutral"}
                    density="compact"
                  />
                </div>
                {linkedInTimeSeries.length === 0 ? (
                  <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                    No LinkedIn activity for this period
                  </div>
                ) : (
                  <LinkedInChart data={linkedInTimeSeries} />
                )}
              </div>
            </CollapsibleSection>

            {/* Section 5: Signals (collapsible, default open) */}
            <CollapsibleSection
              id="signals"
              title="Signals"
              collapsedSummary={
                signalsData ? (
                  <span className="text-xs text-muted-foreground">
                    {signalsData.summary?.totalSignals ?? 0} signals (7d) · ${(signalsData.summary?.totalWeeklyUsd ?? 0).toFixed(2)} spend
                  </span>
                ) : null
              }
            >
              <div className="grid grid-cols-3 gap-3">
                <MetricCard
                  label="Signals (7d)"
                  value={signalsData?.summary?.totalSignals?.toLocaleString() ?? "—"}
                  trend={(signalsData?.summary?.totalSignals ?? 0) > 0 ? "up" : "neutral"}
                  density="compact"
                />
                <MetricCard
                  label="Daily Spend"
                  value={signalsData ? `$${(signalsData.summary?.totalDailyUsd ?? 0).toFixed(2)}` : "—"}
                  trend="neutral"
                  density="compact"
                />
                <MetricCard
                  label="Weekly Spend"
                  value={signalsData ? `$${(signalsData.summary?.totalWeeklyUsd ?? 0).toFixed(2)}` : "—"}
                  trend="neutral"
                  density="compact"
                />
              </div>
            </CollapsibleSection>

            {/* Section 6: Pipeline (collapsible, default open) */}
            <CollapsibleSection
              id="pipeline"
              title="Pipeline"
              collapsedSummary={
                <span className="text-xs text-muted-foreground">
                  {kpis.pipelineContacted.toLocaleString()} contacted · {kpis.pipelineReplied.toLocaleString()} replied · {kpis.pipelineInterested.toLocaleString()} interested
                </span>
              }
            >
              <div className="grid grid-cols-3 gap-3">
                <MetricCard
                  label="Contacted"
                  value={kpis.pipelineContacted.toLocaleString()}
                  trend="neutral"
                  density="compact"
                />
                <MetricCard
                  label="Replied"
                  value={kpis.pipelineReplied.toLocaleString()}
                  trend={kpis.pipelineReplied > 0 ? "up" : "neutral"}
                  detail={
                    kpis.pipelineContacted > 0
                      ? `${((kpis.pipelineReplied / kpis.pipelineContacted) * 100).toFixed(1)}% reply rate`
                      : undefined
                  }
                  density="compact"
                />
                <MetricCard
                  label="Interested"
                  value={kpis.pipelineInterested.toLocaleString()}
                  trend={kpis.pipelineInterested > 0 ? "up" : "neutral"}
                  density="compact"
                />
              </div>
            </CollapsibleSection>

            {/* Section 7: Client Overview (collapsible, default COLLAPSED) */}
            <CollapsibleSection
              id="clients"
              title="Client Overview"
              defaultCollapsed
              collapsedSummary={
                <span className="text-xs text-muted-foreground">
                  {workspaces.length} workspaces
                </span>
              }
            >
              <Card>
                <CardContent className="p-0">
                  <OverviewTable summaries={buildWorkspaceSummaries(workspaces, kpis)} />
                </CardContent>
              </Card>
            </CollapsibleSection>
          </>
        ) : null}
      </div>
    </div>
  );
}
