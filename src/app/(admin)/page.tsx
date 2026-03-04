"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useQueryState } from "nuqs";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ClientFilter } from "@/components/dashboard/client-filter";
import { ActivityChart, ActivityChartLegend } from "@/components/dashboard/activity-chart";
import { AlertsSection } from "@/components/dashboard/alerts-section";
import {
  OverviewTable,
  type WorkspaceSummary,
} from "@/components/dashboard/overview-table";
import type {
  DashboardStatsResponse,
  DashboardKPIs,
  TimeSeriesPoint,
  DashboardAlert,
  WorkspaceOption,
} from "@/app/api/dashboard/stats/route";
import { cn } from "@/lib/utils";

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
  pipelineMeetings: 0,
  sendersHealthy: 0,
  sendersWarning: 0,
  sendersPaused: 0,
  sendersBlocked: 0,
  sendersSessionExpired: 0,
  sendersActiveTotal: 0,
  campaignsActive: 0,
  campaignsPaused: 0,
  campaignsDraft: 0,
  inboxesConnected: 0,
  inboxesDisconnected: 0,
};

function buildWorkspaceSummaries(
  workspaces: WorkspaceOption[],
  kpis: DashboardKPIs
): WorkspaceSummary[] {
  // When viewing "all", we don't have per-workspace breakdown from this endpoint.
  // Return minimal summary rows for each workspace.
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

function SecondaryKpis({
  kpis,
  bounceRate,
}: {
  kpis: DashboardKPIs;
  bounceRate: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
        {open ? "Hide details" : "More stats"}
      </Button>
      {open && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-2">
          <MetricCard
            label="Bounces"
            value={kpis.emailBounced.toLocaleString()}
            trend={kpis.emailBounced > 0 ? "down" : "neutral"}
            detail={kpis.emailBounced > 0 ? `${bounceRate}% bounce rate` : "Clean"}
            density="compact"
          />
          <MetricCard
            label="Contacted"
            value={kpis.pipelineContacted.toLocaleString()}
            trend="neutral"
            density="compact"
          />
          <MetricCard
            label="LI Connections"
            value={kpis.linkedinConnect.toLocaleString()}
            trend={kpis.linkedinConnect > 0 ? "up" : "neutral"}
            density="compact"
          />
          <MetricCard
            label="LI Messages"
            value={kpis.linkedinMessage.toLocaleString()}
            trend={kpis.linkedinMessage > 0 ? "up" : "neutral"}
            density="compact"
          />
          <MetricCard
            label="Inboxes"
            value={kpis.inboxesConnected.toLocaleString()}
            trend={kpis.inboxesDisconnected > 0 ? "warning" : "up"}
            detail={kpis.inboxesDisconnected > 0 ? `${kpis.inboxesDisconnected} disconnected` : "All connected"}
            density="compact"
          />
        </div>
      )}
    </div>
  );
}

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
      const res = await fetch(`/api/dashboard/stats?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardStatsResponse;
      setData(json);
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

  const unhealthySenders =
    kpis.sendersWarning + kpis.sendersPaused + kpis.sendersBlocked + kpis.sendersSessionExpired;

  return (
    <div>
      <Header
        title="Dashboard"
        description={`${days === "7" ? "Last 7 days" : days === "14" ? "Last 14 days" : days === "30" ? "Last 30 days" : "Last 90 days"} ${workspace !== "all" ? `· ${workspace}` : "· all campaigns"}`}
        actions={<ClientFilter workspaces={workspaces} />}
      />

      <div className="p-6 space-y-6">
        {/* Alerts — shown above KPIs so critical items are immediately visible */}
        {!loading && alerts.length > 0 && (
          <AlertsSection alerts={alerts} />
        )}

        {/* Primary KPIs — the 6 metrics that matter most */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
          ) : (
            <>
              <MetricCard
                label="Reply Rate"
                value={replyRate === "—" ? "—" : `${replyRate}%`}
                trend={totalReplies > 0 ? "up" : "neutral"}
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
                label="Interested"
                value={kpis.pipelineInterested.toLocaleString()}
                trend={kpis.pipelineInterested > 0 ? "up" : "neutral"}
                density="compact"
              />
              <MetricCard
                label="Meetings Booked"
                value={kpis.pipelineMeetings.toLocaleString()}
                trend={kpis.pipelineMeetings > 0 ? "up" : "neutral"}
                density="compact"
              />
              <MetricCard
                label="Active Campaigns"
                value={kpis.campaignsActive.toLocaleString()}
                trend={kpis.campaignsActive > 0 ? "up" : "neutral"}
                detail={kpis.campaignsPaused > 0 ? `${kpis.campaignsPaused} paused` : undefined}
                density="compact"
              />
              <Link href="/senders" className="block">
                <MetricCard
                  label="Sender Health"
                  value={`${kpis.sendersHealthy}/${kpis.sendersActiveTotal || kpis.sendersHealthy + unhealthySenders}`}
                  trend={unhealthySenders > 0 ? "warning" : "up"}
                  detail={unhealthySenders > 0 ? `${unhealthySenders} need attention` : "All healthy"}
                  density="compact"
                />
              </Link>
            </>
          )}
        </div>

        {/* Secondary KPIs — expandable for deeper drill-down */}
        {!loading && (
          <SecondaryKpis kpis={kpis} bounceRate={bounceRate} />
        )}

        {/* Activity Chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="font-heading text-sm font-semibold">
                Email Activity
              </CardTitle>
              <ActivityChartLegend />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : error ? (
              <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                {error}
              </div>
            ) : timeSeries.length === 0 ? (
              <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                No activity data for this period
              </div>
            ) : (
              <ActivityChart data={timeSeries} />
            )}
          </CardContent>
        </Card>

        {/* Workspace Overview Table */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-sm font-semibold">
              Workspace Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : (
              <OverviewTable
                summaries={buildWorkspaceSummaries(workspaces, kpis)}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
