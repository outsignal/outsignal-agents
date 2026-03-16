"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
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

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground pt-6 pb-2">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading state — matches the actual layout
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero metric row */}
      <div>
        <div className="h-4 w-24 bg-muted rounded animate-pulse mb-2 mt-6" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="col-span-2">
            <Skeleton className="h-[140px] rounded-lg" />
          </div>
          <Skeleton className="h-[140px] rounded-lg" />
          <Skeleton className="h-[140px] rounded-lg" />
        </div>
      </div>

      {/* Health row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[96px] rounded-lg" />
        ))}
      </div>

      {/* Activity section */}
      <div>
        <div className="h-4 w-20 bg-muted rounded animate-pulse mb-2 mt-6" />
        <Card>
          <CardHeader>
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[280px] rounded-lg" />
          </CardContent>
        </Card>
      </div>

      {/* Collapsible section skeletons */}
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-12 rounded-lg" />
      ))}
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
      if (statsRes.status === 401) {
        window.location.href = "/login";
        return;
      }
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

  return (
    <div>
      {/* Header */}
      <Header
        title="Dashboard"
        description={`${days === "7" ? "Last 7 days" : days === "14" ? "Last 14 days" : days === "30" ? "Last 30 days" : "Last 90 days"} ${workspace !== "all" ? `\u00b7 ${workspace}` : "\u00b7 all campaigns"}`}
        actions={<ClientFilter workspaces={workspaces} />}
      />

      <div className="p-6 space-y-2">
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
            {/* ============================================================ */}
            {/* KEY METRICS — Hero bento grid                                */}
            {/* ============================================================ */}
            <SectionLabel>Key Metrics</SectionLabel>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Hero: Total Replies — spans 2 cols */}
              <div className="col-span-2">
                <MetricCard
                  label="Total Replies"
                  value={totalReplies.toLocaleString()}
                  variant="hero"
                  trend={totalReplies > 0 ? "up" : "neutral"}
                  detail={`${replyRate === "\u2014" ? "\u2014" : `${replyRate}%`} reply rate \u00b7 ${kpis.emailAutoReplied} auto`}
                  sparklineData={sparklineReplies.length > 1 ? sparklineReplies : undefined}
                  sparklineColor="#635BFF"
                  className="h-full"
                />
              </div>

              {/* Emails Sent */}
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

              {/* LinkedIn Actions */}
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

            {/* ============================================================ */}
            {/* SYSTEM HEALTH — compact row                                  */}
            {/* ============================================================ */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mt-4">
              <MetricCard
                label="Senders"
                value={`${kpis.linkedinAccountsActive}`}
                suffix="active"
                trend={kpis.linkedinAccountsExpired > 0 ? "warning" : kpis.linkedinAccountsActive > 0 ? "up" : "neutral"}
                detail={`${kpis.linkedinAccountsTotal} total${kpis.linkedinAccountsExpired > 0 ? ` \u00b7 ${kpis.linkedinAccountsExpired} expired` : ""}`}
                density="compact"
                href="/senders"
                className="h-full"
              />
              <MetricCard
                label="Inboxes"
                value={`${kpis.inboxesTotal}`}
                suffix="total"
                trend={kpis.inboxesCritical > 0 ? "down" : kpis.inboxesWarning > 0 ? "warning" : kpis.inboxesHealthy > 0 ? "up" : "neutral"}
                detail={`${kpis.inboxesHealthy} healthy \u00b7 ${kpis.inboxesWarning} warn \u00b7 ${kpis.inboxesCritical} crit`}
                density="compact"
                className="h-full"
              />
              <MetricCard
                label="Campaigns"
                value={`${kpis.campaignsActive + kpis.campaignsPaused + kpis.campaignsCompleted + kpis.campaignsDraft}`}
                suffix="total"
                trend={kpis.campaignsActive > 0 ? "up" : "neutral"}
                detail={`${kpis.campaignsActive} active \u00b7 ${kpis.campaignsPaused} paused \u00b7 ${kpis.campaignsCompleted} done`}
                density="compact"
                className="h-full"
              />
              <MetricCard
                label="Pipeline"
                value={kpis.pipelineContacted.toLocaleString()}
                suffix="contacted"
                trend={kpis.pipelineInterested > 0 ? "up" : "neutral"}
                detail={`${kpis.pipelineReplied} replied \u00b7 ${kpis.pipelineInterested} interested`}
                density="compact"
                className="h-full"
              />

              {/* Worker status card */}
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
                  <Card
                    density="compact"
                    className="h-full relative overflow-hidden"
                  >
                    {/* Top accent line */}
                    <div
                      className={cn(
                        "absolute top-0 left-0 right-0 h-0.5",
                        kpis.workerStatus === "online" ? "bg-emerald-500"
                        : kpis.workerStatus === "paused" ? "bg-amber-500"
                        : "bg-red-500",
                      )}
                    />
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Worker</p>
                        <span className="relative flex h-2.5 w-2.5">
                          {kpis.workerStatus === "online" && (
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          )}
                          <span
                            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                              kpis.workerStatus === "online" ? "bg-emerald-500"
                              : kpis.workerStatus === "paused" ? "bg-amber-500"
                              : "bg-red-500"
                            }`}
                          />
                        </span>
                      </div>
                      <p className="mt-1.5 font-mono text-3xl font-semibold tabular-nums tracking-tight">
                        {kpis.workerStatus === "online" ? "Online" : kpis.workerStatus === "paused" ? "Paused" : "Offline"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {workerDetail}{kpis.workerStatus === "paused" ? " \u00b7 Outside business hours" : ""}
                      </p>
                    </CardContent>
                  </Card>
                );
              })()}
            </div>

            {/* ============================================================ */}
            {/* ACTIVITY — Combined chart                                    */}
            {/* ============================================================ */}
            <SectionLabel>Activity</SectionLabel>

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

            {/* ============================================================ */}
            {/* PERFORMANCE — Email & LinkedIn detail sections               */}
            {/* ============================================================ */}
            <SectionLabel>Performance</SectionLabel>

            {/* Email (collapsible, default open) */}
            <CollapsibleSection
              id="email"
              title="Email"
              collapsedSummary={
                <span className="text-xs text-muted-foreground">
                  {kpis.emailSent.toLocaleString()} sent \u00b7 {replyRate === "\u2014" ? "\u2014" : `${replyRate}%`} reply rate
                </span>
              }
              actions={<ActivityChartLegend />}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <MetricCard
                    label="Reply Rate"
                    value={replyRate === "\u2014" ? "\u2014" : replyRate}
                    suffix={replyRate !== "\u2014" ? "%" : undefined}
                    trend={Number(replyRate) > 0 ? "up" : "neutral"}
                    detail={`${totalReplies.toLocaleString()} replies \u00b7 ${kpis.emailAutoReplied} OOO/auto`}
                    density="compact"
                    variant="hero"
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
                  <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
                    No email activity for this period
                  </div>
                ) : (
                  <ActivityChart data={timeSeries} />
                )}
              </div>
            </CollapsibleSection>

            {/* LinkedIn (collapsible, default open) */}
            <CollapsibleSection
              id="linkedin"
              title="LinkedIn"
              collapsedSummary={
                <span className="text-xs text-muted-foreground">
                  {(kpis.linkedinConnect + kpis.linkedinMessage + kpis.linkedinProfileView).toLocaleString()} actions \u00b7 {kpis.linkedinConnect.toLocaleString()} connections
                </span>
              }
              actions={<LinkedInChartLegend />}
            >
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                  <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
                    No LinkedIn activity for this period
                  </div>
                ) : (
                  <LinkedInChart data={linkedInTimeSeries} />
                )}
              </div>
            </CollapsibleSection>

            {/* ============================================================ */}
            {/* OVERVIEW — Signals, Client table                             */}
            {/* ============================================================ */}
            <SectionLabel>Overview</SectionLabel>

            {/* Signals (collapsible, default open) */}
            <CollapsibleSection
              id="signals"
              title="Signals"
              collapsedSummary={
                signalsData ? (
                  <span className="text-xs text-muted-foreground">
                    {signalsData.summary?.totalSignals ?? 0} signals (7d) \u00b7 ${(signalsData.summary?.totalWeeklyUsd ?? 0).toFixed(2)} spend
                  </span>
                ) : null
              }
            >
              <div className="grid grid-cols-3 gap-4">
                <MetricCard
                  label="Signals (7d)"
                  value={signalsData?.summary?.totalSignals?.toLocaleString() ?? "\u2014"}
                  trend={(signalsData?.summary?.totalSignals ?? 0) > 0 ? "up" : "neutral"}
                  density="compact"
                />
                <MetricCard
                  label="Daily Spend"
                  value={signalsData ? `$${(signalsData.summary?.totalDailyUsd ?? 0).toFixed(2)}` : "\u2014"}
                  trend="neutral"
                  density="compact"
                />
                <MetricCard
                  label="Weekly Spend"
                  value={signalsData ? `$${(signalsData.summary?.totalWeeklyUsd ?? 0).toFixed(2)}` : "\u2014"}
                  trend="neutral"
                  density="compact"
                />
              </div>
            </CollapsibleSection>

            {/* Client Overview (collapsible, default COLLAPSED) */}
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
