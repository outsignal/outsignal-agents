import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Linkedin } from "lucide-react";
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
  const totalOpens = campaigns.reduce((sum, c) => sum + (c.unique_opens ?? 0), 0);
  const totalReplies = campaigns.reduce((sum, c) => sum + (c.replied ?? 0), 0);
  const totalBounces = campaigns.reduce((sum, c) => sum + (c.bounced ?? 0), 0);
  const hasOpenTracking = campaigns.some((c) => c.open_tracking);

  // LinkedIn summary
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgoLI = new Date();
  sevenDaysAgoLI.setDate(sevenDaysAgoLI.getDate() - 7);

  const [senderCount, totalSenderCount, todayActions, weekActions, pendingActions] = await Promise.all([
    prisma.sender.count({
      where: { workspaceSlug, sessionStatus: "active" },
    }),
    prisma.sender.count({
      where: { workspaceSlug },
    }),
    prisma.linkedInAction.count({
      where: {
        workspaceSlug,
        status: "complete",
        completedAt: { gte: todayStart },
      },
    }),
    prisma.linkedInAction.count({
      where: {
        workspaceSlug,
        status: "complete",
        completedAt: { gte: sevenDaysAgoLI },
      },
    }),
    prisma.linkedInAction.count({
      where: {
        workspaceSlug,
        status: "pending",
      },
    }),
  ]);

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

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    paused: "bg-yellow-100 text-yellow-800",
    draft: "bg-gray-100 text-gray-800",
    completed: "bg-blue-100 text-blue-800",
  };

  // Pending approval campaigns count
  const pendingApprovalCount = await prisma.campaign.count({
    where: { workspaceSlug, status: "pending_approval" },
  });

  // Recent inbound replies
  const recentReplies = await prisma.reply.findMany({
    where: { workspaceSlug, direction: "inbound" },
    orderBy: { receivedAt: "desc" },
    take: 10,
    select: {
      id: true,
      leadEmail: true,
      subject: true,
      receivedAt: true,
      intent: true,
      sentiment: true,
    },
  });

  const now = new Date();

  const intentColors: Record<string, string> = {
    interested: "bg-emerald-100 text-emerald-800",
    meeting_request: "bg-emerald-100 text-emerald-800",
    positive: "bg-emerald-100 text-emerald-800",
    not_interested: "bg-red-100 text-red-800",
    objection: "bg-amber-100 text-amber-800",
    out_of_office: "bg-gray-100 text-gray-800",
    referral: "bg-blue-100 text-blue-800",
    unsubscribe: "bg-red-100 text-red-800",
    neutral: "bg-gray-100 text-gray-800",
  };

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
          <h1 className="text-2xl font-heading font-bold">{workspace.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Campaign performance overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RelativeTimestamp timestamp={now.toISOString()} />
          <PortalRefreshButton />
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Sent"
          value={totalSent.toLocaleString()}
          density="compact"
        />
        <MetricCard
          label="Open Rate"
          value={hasOpenTracking ? `${totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(1) : 0}%` : "N/A"}
          detail={hasOpenTracking ? undefined : "Tracking disabled"}
          density="compact"
        />
        <MetricCard
          label="Reply Rate"
          value={`${totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1) : 0}%`}
          trend={
            totalSent > 0 && (totalReplies / totalSent) * 100 > 3 ? "up" : "neutral"
          }
          density="compact"
        />
        <MetricCard
          label="Bounce Rate"
          value={`${totalSent > 0 ? ((totalBounces / totalSent) * 100).toFixed(1) : 0}%`}
          trend={
            totalSent > 0 && (totalBounces / totalSent) * 100 > 5 ? "warning" : "neutral"
          }
          density="compact"
        />
      </div>

      {/* Campaign Performance Chart */}
      {performanceTimeSeries.some((d) => d.sent > 0 || d.replied > 0 || d.bounced > 0 || d.interested > 0 || d.unsubscribed > 0) && (
        <Card density="compact">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="font-heading text-base">
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

      {/* LinkedIn Summary */}
      <Card density="compact">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Linkedin className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">LinkedIn Overview</p>
            </div>
            <Link
              href="/portal/linkedin"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              View details
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-2xl font-heading font-semibold tabular-nums">
                {senderCount}
                {totalSenderCount > senderCount && (
                  <span className="text-sm text-muted-foreground font-normal">
                    /{totalSenderCount}
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Active sender{senderCount !== 1 ? "s" : ""}
              </p>
            </div>
            <div>
              <p className="text-2xl font-heading font-semibold tabular-nums">
                {todayActions}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Action{todayActions !== 1 ? "s" : ""} today
              </p>
            </div>
            <div>
              <p className="text-2xl font-heading font-semibold tabular-nums">
                {weekActions}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last 7 days
              </p>
            </div>
            <div>
              <p className="text-2xl font-heading font-semibold tabular-nums">
                {pendingActions}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pending
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campaigns Table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Campaigns</CardTitle>
        </CardHeader>
        <CardContent>
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <svg
                  className="h-6 w-6 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21.75 9v.906a2.25 2.25 0 01-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 001.183 1.981l6.478 3.488m8.839 2.51l-4.66-2.51m0 0l-1.023-.55a2.25 2.25 0 00-2.134 0l-1.022.55m0 0l-4.661 2.51m16.5 1.615a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V8.844a2.25 2.25 0 011.183-1.98l7.5-4.04a2.25 2.25 0 012.134 0l7.5 4.04a2.25 2.25 0 011.183 1.98V18"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium">No campaigns yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Your campaigns will appear here once they are set up.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead className="text-right">Reply Rate</TableHead>
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
                      className={internalId ? "hover:bg-muted/50 cursor-pointer group" : ""}
                    >
                      <TableCell className="font-medium">
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
                        <Badge
                          className={`text-xs ${statusColors[campaign.status] ?? ""}`}
                        >
                          {campaign.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {campaign.total_leads.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sent.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {campaign.replied.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{rRate}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Recent Replies */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Recent Replies</CardTitle>
        </CardHeader>
        <CardContent>
          {recentReplies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <svg
                  className="h-6 w-6 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium">No replies yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Replies to your campaigns will appear here.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Intent</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentReplies.map((reply) => (
                  <TableRow key={reply.id}>
                    <TableCell className="font-medium text-sm">
                      {reply.leadEmail}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
                      {reply.subject ?? "—"}
                    </TableCell>
                    <TableCell>
                      {reply.intent ? (
                        <Badge
                          className={`text-xs ${intentColors[reply.intent] ?? "bg-gray-100 text-gray-800"}`}
                        >
                          {reply.intent.replace(/_/g, " ")}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground whitespace-nowrap">
                      {reply.receivedAt
                        ? new Date(reply.receivedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
