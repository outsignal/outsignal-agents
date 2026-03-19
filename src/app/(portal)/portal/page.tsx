import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { PortalRefreshButton } from "@/components/portal/portal-refresh-button";
import { type PerformanceDayPoint } from "@/components/portal/portal-performance-chart";
import { RelativeTimestamp } from "@/components/portal/relative-timestamp";
import { PeriodSelector } from "@/components/portal/period-selector";
import { Mail } from "lucide-react";
import { EmailBisonClient } from "@/lib/emailbison/client";

import Link from "next/link";


const VALID_PERIODS = [7, 14, 30, 90] as const;

export default async function PortalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const timeSeriesDays = VALID_PERIODS.includes(Number(periodParam) as (typeof VALID_PERIODS)[number])
    ? Number(periodParam)
    : 14;
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

  // Time-series data for the selected period
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - timeSeriesDays);

  // LinkedIn actions — only query if workspace package includes LinkedIn
  const hasLinkedIn = workspace.package === "linkedin" || workspace.package === "email_linkedin";
  const linkedInActions = hasLinkedIn
    ? await prisma.linkedInAction.findMany({
        where: {
          workspaceSlug,
          createdAt: { gte: sinceDate },
          status: "complete",
        },
        select: {
          createdAt: true,
          actionType: true,
        },
      })
    : [];

  const linkedInTotals = {
    connections: linkedInActions.filter((a) => a.actionType === "connect").length,
    messages: linkedInActions.filter((a) => a.actionType === "message").length,
    profileViews: linkedInActions.filter((a) => a.actionType === "profile_view").length,
  };

  // Fetch sent count from EmailBison workspace stats API (source of truth).
  // This gives us the exact sent count for the selected time period directly.
  let ebPeriodSent = 0;
  if (workspace.apiToken) {
    try {
      const ebClient = new EmailBisonClient(workspace.apiToken);
      const startDate = sinceDate.toISOString().slice(0, 10);
      const endDate = new Date().toISOString().slice(0, 10);
      const stats = await ebClient.getWorkspaceStats(startDate, endDate);
      ebPeriodSent = parseInt(stats.emails_sent, 10) || 0;
    } catch (err) {
      console.warn("[portal-dashboard] Failed to fetch EB workspace stats:", err);
    }
  }

  // Webhook events — still used for bounce/interested/unsubscribed tracking
  // and as fallback for sent count if EB API is unavailable
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

  // Reply counts from Reply model (more complete than webhook events — includes poll-replies cron)
  const periodRepliesRaw = await prisma.reply.findMany({
    where: {
      workspaceSlug,
      direction: "inbound",
      receivedAt: { gte: sinceDate },
    },
    select: { receivedAt: true },
  });

  const replyDayMap = new Map<string, number>();
  for (const r of periodRepliesRaw) {
    const key = r.receivedAt.toISOString().slice(0, 10);
    replyDayMap.set(key, (replyDayMap.get(key) ?? 0) + 1);
  }

  const periodReplyCount = periodRepliesRaw.length;

  const replySparklineFromDb: number[] = [];
  for (let i = timeSeriesDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    replySparklineFromDb.push(replyDayMap.get(dateStr) ?? 0);
  }

  // Period-scoped totals
  // Sent count: prefer EmailBison API (source of truth — includes campaigns managed directly in EB).
  // Fall back to webhook EMAIL_SENT events if EB API was unavailable.
  const webhookSent = performanceTimeSeries.reduce((sum, d) => sum + d.sent, 0);
  const periodSent = ebPeriodSent > 0 ? ebPeriodSent : webhookSent;
  const periodReplyRate = periodSent > 0 ? (periodReplyCount / periodSent) * 100 : 0;

  // Pending approval campaigns count
  const pendingApprovalCount = await prisma.campaign.count({
    where: { workspaceSlug, status: "pending_approval" },
  });

  const now = new Date();

  // LinkedIn connects sparkline: daily connect counts over the same period
  const linkedInConnectsSparkline: number[] = [];
  for (let i = timeSeriesDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = linkedInActions.filter(
      (a) => a.actionType === "connect" && a.createdAt.toISOString().slice(0, 10) === dateStr
    ).length;
    linkedInConnectsSparkline.push(count);
  }

  // LinkedIn messages sparkline: daily message counts over the same period
  const linkedInMessagesSparkline: number[] = [];
  for (let i = timeSeriesDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = linkedInActions.filter(
      (a) => a.actionType === "message" && a.createdAt.toISOString().slice(0, 10) === dateStr
    ).length;
    linkedInMessagesSparkline.push(count);
  }

  // LinkedIn worker online status — only query if package includes LinkedIn
  const linkedInSender = hasLinkedIn
    ? await prisma.sender.findFirst({
        where: { workspaceSlug, linkedinProfileUrl: { not: null } },
        select: { lastPolledAt: true },
      })
    : null;
  const linkedInWorkerOnline =
    linkedInSender?.lastPolledAt &&
    now.getTime() - linkedInSender.lastPolledAt.getTime() < 10 * 60 * 1000;

  // Build sparkline arrays from time series
  const sentSparkline = performanceTimeSeries.map((d) => d.sent);

  // Recent replies
  const recentReplies = await prisma.reply.findMany({
    where: {
      workspaceSlug,
      direction: "inbound",
    },
    select: {
      id: true,
      senderName: true,
      senderEmail: true,
      subject: true,
      bodyText: true,
      receivedAt: true,
      campaignName: true,
      intent: true,
    },
    orderBy: { receivedAt: "desc" },
    take: 5,
  });

  return (
    <div className="p-6 space-y-6">
      {/* Pending Approval Banner */}
      {pendingApprovalCount > 0 && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {pendingApprovalCount} campaign{pendingApprovalCount !== 1 ? "s" : ""} awaiting your approval
          </p>
          <Link
            href="/portal/campaigns"
            className="text-sm font-medium text-amber-900 dark:text-amber-100 underline hover:no-underline"
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
            Campaign performance overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodSelector />
          <RelativeTimestamp timestamp={now.toISOString()} />
          <PortalRefreshButton />
        </div>
      </div>

      {/* Email */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email</p>
        <div className="grid grid-cols-3 gap-4">
          <MetricCard label="Replies" value={periodReplyCount.toLocaleString()} sparklineData={replySparklineFromDb} sparklineColor="#635BFF" density="compact" icon="MessageSquareText" />
          <MetricCard label="Sent" value={periodSent.toLocaleString()} sparklineData={sentSparkline} sparklineColor="#635BFF" density="compact" icon="Send" />
          <MetricCard label="Reply Rate" value={periodReplyRate.toFixed(1)} suffix="%" sparklineData={sentSparkline.map((sent, i) => sent > 0 ? (replySparklineFromDb[i] / sent) * 100 : 0)} sparklineColor="#635BFF" density="compact" icon="TrendingUp" />
        </div>
      </div>

      {/* LinkedIn — only shown for packages that include LinkedIn */}
      {hasLinkedIn && (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">LinkedIn</p>
            <div className="grid grid-cols-3 gap-4">
              <MetricCard label="Requests Sent" value={linkedInTotals.connections.toLocaleString()} sparklineData={linkedInConnectsSparkline} sparklineColor="#635BFF" density="compact" icon="Send" />
              <MetricCard label="Connections Made" value={linkedInTotals.connections.toLocaleString()} detail="Accepted connections" sparklineData={linkedInConnectsSparkline} sparklineColor="#635BFF" density="compact" icon="CheckCircle" />
              <MetricCard label="Messages Sent" value={linkedInTotals.messages.toLocaleString()} sparklineData={linkedInMessagesSparkline} sparklineColor="#635BFF" density="compact" icon="MessageSquare" />
            </div>
          </div>

          {/* Worker Status */}
          <div className={`rounded-lg px-4 py-2.5 flex items-center gap-2.5 text-sm ${
            linkedInWorkerOnline
              ? "bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
              : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
          }`}>
            {linkedInWorkerOnline ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 dark:bg-emerald-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 dark:bg-emerald-400"></span>
              </span>
            ) : (
              <span className="inline-flex rounded-full h-2 w-2 bg-red-500 dark:bg-red-400"></span>
            )}
            <span className="font-medium">{linkedInWorkerOnline ? "LinkedIn Worker Online" : "LinkedIn Worker Offline"}</span>
            <span className="text-xs opacity-70">
              {(() => {
                if (!linkedInSender?.lastPolledAt) return "";
                const mins = Math.floor((now.getTime() - linkedInSender.lastPolledAt.getTime()) / 60000);
                if (mins < 1) return "· just now";
                if (mins < 60) return `· ${mins}m ago`;
                const hours = Math.floor(mins / 60);
                if (hours < 24) return `· ${hours}h ago`;
                return `· ${Math.floor(hours / 24)}d ago`;
              })()}
            </span>
          </div>
        </>
      )}

      {/* Recent Replies */}
      <Card density="compact">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base text-foreground">Recent Replies</CardTitle>
            <Link href="/portal/inbox" className="text-xs font-medium text-brand hover:underline">
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recentReplies.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No replies yet</p>
          ) : (
            <div className="divide-y divide-border">
              {recentReplies.map((reply) => (
                <Link
                  key={reply.id}
                  href="/portal/inbox"
                  className="flex items-center gap-3 py-2.5 hover:bg-muted/50 -mx-2 px-2 rounded transition-colors"
                >
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground truncate">
                        {reply.senderName || reply.senderEmail}
                      </span>
                      {reply.intent && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                          reply.intent === "interested" || reply.intent === "meeting_booked"
                            ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                            : reply.intent === "objection" || reply.intent === "unsubscribe"
                              ? "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300"
                              : "bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400"
                        }`}>
                          {reply.intent.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {reply.subject || reply.bodyText?.slice(0, 80) || "No subject"}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {(() => {
                      const mins = Math.floor((now.getTime() - reply.receivedAt.getTime()) / 60000);
                      if (mins < 1) return "now";
                      if (mins < 60) return `${mins}m`;
                      const hours = Math.floor(mins / 60);
                      if (hours < 24) return `${hours}h`;
                      return `${Math.floor(hours / 24)}d`;
                    })()}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
