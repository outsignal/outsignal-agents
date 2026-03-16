import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { PortalRefreshButton } from "@/components/portal/portal-refresh-button";
import {
  PortalPerformanceChart,
  PerformanceChartLegend,
  type PerformanceDayPoint,
} from "@/components/portal/portal-performance-chart";
import { RelativeTimestamp } from "@/components/portal/relative-timestamp";

import Link from "next/link";
import type { Campaign } from "@/lib/emailbison/types";

export default async function PortalDashboardPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;
  const workspace = await getWorkspaceBySlug(workspaceSlug);

  if (!workspace) {
    return (
      <div className="p-6">
        <div className="text-center py-12 text-muted-foreground">
          Your workspace is being set up. Check back soon.
        </div>
      </div>
    );
  }

  const client = new EmailBisonClient(workspace.apiToken);

  let campaigns: Campaign[] = [];
  let error: string | null = null;

  try {
    campaigns = await client.getCampaigns();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to fetch campaigns";
  }

  // Build a mapping from EmailBison campaign ID to internal campaign ID
  const ebCampaignIds = campaigns.map((c) => c.id).filter(Boolean);
  const internalCampaigns = ebCampaignIds.length > 0
    ? await prisma.campaign.findMany({
        where: {
          workspaceSlug,
          emailBisonCampaignId: { in: ebCampaignIds },
        },
        select: { id: true, emailBisonCampaignId: true },
      })
    : [];
  const ebToInternalId = new Map(
    internalCampaigns
      .filter((c) => c.emailBisonCampaignId !== null)
      .map((c) => [c.emailBisonCampaignId!, c.id]),
  );

  const totalSent = campaigns.reduce((sum, c) => sum + (c.emails_sent ?? 0), 0);
  const totalReplies = campaigns.reduce((sum, c) => sum + (c.replied ?? 0), 0);

  // Time-series data from WebhookEvent for the last 14 days
  const timeSeriesDays = 14;
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - timeSeriesDays);

  const webhookEvents = await prisma.webhookEvent.findMany({
    where: {
      workspace: workspaceSlug,
      receivedAt: { gte: sinceDate },
      eventType: {
        in: ["EMAIL_SENT", "LEAD_REPLIED", "LEAD_INTERESTED", "EMAIL_BOUNCED", "LEAD_UNSUBSCRIBED"],
      },
      isAutomated: false,
    },
    select: {
      receivedAt: true,
      eventType: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  const emptyDay = (date: string): PerformanceDayPoint => ({
    date,
    sent: 0,
    replied: 0,
    bounced: 0,
    interested: 0,
    unsubscribed: 0,
  });

  const timeSeriesMap: Record<string, PerformanceDayPoint> = {};
  for (const event of webhookEvents) {
    const dateStr = event.receivedAt.toISOString().slice(0, 10);
    if (!timeSeriesMap[dateStr]) {
      timeSeriesMap[dateStr] = emptyDay(dateStr);
    }
    const day = timeSeriesMap[dateStr];
    switch (event.eventType) {
      case "EMAIL_SENT": day.sent++; break;
      case "LEAD_REPLIED": day.replied++; break;
      case "LEAD_INTERESTED": day.interested++; break;
      case "EMAIL_BOUNCED": day.bounced++; break;
      case "LEAD_UNSUBSCRIBED": day.unsubscribed++; break;
    }
  }

  // Fill in all days in range (including zeros)
  const performanceTimeSeries: PerformanceDayPoint[] = [];
  for (let i = timeSeriesDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    performanceTimeSeries.push(
      timeSeriesMap[dateStr] ?? emptyDay(dateStr)
    );
  }

  // Pending approval campaigns count
  const pendingApprovalCount = await prisma.campaign.count({
    where: { workspaceSlug, status: "pending_approval" },
  });

  const now = new Date();

  // Computed rates
  const replyRate = totalSent > 0 ? ((totalReplies / totalSent) * 100) : 0;

  // Build sparkline arrays from time series
  const sentSparkline = performanceTimeSeries.map((d) => d.sent);
  const repliesSparkline = performanceTimeSeries.map((d) => d.replied);

  return (
    <div className="p-6 space-y-6">
      {/* Pending Approval Banner */}
      {pendingApprovalCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-medium text-amber-800">
            {pendingApprovalCount} campaign{pendingApprovalCount !== 1 ? "s" : ""} awaiting your approval
          </p>
          <Link
            href="/portal/campaigns"
            className="text-sm font-medium text-amber-900 underline hover:no-underline"
          >
            Review campaigns
          </Link>
        </div>
      )}

      {/* Header with refresh */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-medium text-foreground">{workspace.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Campaign performance overview · <Link href="/portal/email-health" className="text-brand hover:underline">Email health</Link> · <Link href="/portal/linkedin" className="text-brand hover:underline">LinkedIn</Link> · <Link href="/portal/replies" className="text-brand hover:underline">Replies</Link>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RelativeTimestamp timestamp={now.toISOString()} />
          <PortalRefreshButton />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Hero Metric Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label="Total Replies"
            value={totalReplies.toLocaleString()}
            sparklineData={repliesSparkline}
            sparklineColor="#635BFF"
            density="compact"
          />
          <MetricCard
            label="Emails Sent"
            value={totalSent.toLocaleString()}
            sparklineData={sentSparkline}
            sparklineColor="var(--muted-foreground)"
            density="compact"
          />
          <MetricCard
            label="Reply Rate"
            value={replyRate.toFixed(1)}
            suffix="%"
            sparklineData={performanceTimeSeries.map((d) => d.sent > 0 ? (d.replied / d.sent) * 100 : 0)}
            sparklineColor="#10B981"
            density="compact"
          />
      </div>

      {/* Campaign Performance Chart */}
      {performanceTimeSeries.some((d) => d.sent > 0 || d.replied > 0 || d.bounced > 0 || d.interested > 0 || d.unsubscribed > 0) && (
          <Card density="compact">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-foreground">
                  Email Activity
                </CardTitle>
                <PerformanceChartLegend />
              </div>
            </CardHeader>
            <CardContent>
              <PortalPerformanceChart data={performanceTimeSeries} />
            </CardContent>
          </Card>
      )}

      {/* Campaigns Table */}
      <div>
        <Card>
          <CardContent className="p-0">
            {campaigns.length === 0 ? (
              <EmptyState
                title="No campaigns yet"
                description="Your campaigns will appear here once they are set up."
                variant="compact"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-muted-foreground">Campaign</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-right text-muted-foreground">Leads</TableHead>
                    <TableHead className="text-right text-muted-foreground">Sent</TableHead>
                    <TableHead className="text-right text-muted-foreground">Replies</TableHead>
                    <TableHead className="text-right text-muted-foreground">Reply Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => {
                    const sent = campaign.emails_sent ?? 0;
                    const rRate =
                      sent > 0
                        ? ((campaign.replied / sent) * 100).toFixed(1)
                        : "0.0";
                    const internalId = ebToInternalId.get(campaign.id);
                    return (
                      <TableRow
                        key={campaign.id}
                        className={`border-border ${internalId ? "hover:bg-muted cursor-pointer group" : ""}`}
                      >
                        <TableCell className="font-medium text-foreground">
                          {internalId ? (
                            <Link
                              href={`/portal/campaigns/${internalId}`}
                              className="group-hover:underline"
                            >
                              {campaign.name}
                            </Link>
                          ) : (
                            campaign.name
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={campaign.status}
                            type="campaign"
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-foreground">
                          {campaign.total_leads.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-foreground">
                          {sent.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-foreground">
                          {campaign.replied.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-foreground">
                          {rRate}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
