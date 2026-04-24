import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, AlertTriangle, LinkedinIcon, Mail } from "lucide-react";

import { MetricCard } from "@/components/dashboard/metric-card";
import { HealthStatusBadge } from "@/components/portal/health-status-badge";
import { PortalConnectButton } from "@/components/portal/linkedin-connect-button";
import { PeriodSelector } from "@/components/portal/period-selector";
import { PortalRefreshButton } from "@/components/portal/portal-refresh-button";
import { type PerformanceDayPoint } from "@/components/portal/portal-performance-chart";
import { RelativeTimestamp } from "@/components/portal/relative-timestamp";
import { WarmupBadge } from "@/components/portal/warmup-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CONNECTION_REQUEST_TYPES, LINKEDIN_ACTION_TYPES } from "@/lib/channels/constants";
import { prisma } from "@/lib/db";
import { getCanonicalLinkedInSender } from "@/lib/linkedin/sender";
import { getPortalSession } from "@/lib/portal-session";
import {
  getPortalDashboardChannels,
  getPortalDashboardMode,
} from "@/lib/portal/dashboard";
import { getWorkspaceDetails } from "@/lib/workspaces";

type EmailReplyPreview = {
  id: string;
  senderName: string | null;
  senderEmail: string | null;
  subject: string | null;
  bodyText: string | null;
  receivedAt: Date;
  campaignName: string | null;
  intent: string | null;
};

type DashboardTickerItem = {
  id: string;
  channel: "email" | "linkedin";
  label: string;
  detail: string | null;
  timestamp: Date;
  href: string;
};

type LinkedInSenderRow = {
  id: string;
  name: string;
  healthStatus: string;
  sessionStatus: string;
  warmupDay: number;
  hasProxy: boolean;
  linkedinProfileUrl: string | null;
  dailyConnectionLimit: number;
  dailyMessageLimit: number;
  dailyProfileViewLimit: number;
  todayConnections: number;
  todayMessages: number;
  todayViews: number;
  pendingActions: number;
  pastDueActions: number;
};

type LinkedInActivityPreview = {
  id: string;
  title: string;
  detail: string | null;
  timestamp: Date;
};

interface EmailDashboardData {
  periodSent: number;
  periodReplyCount: number;
  periodReplyRate: number;
  sentSparkline: number[];
  replySparkline: number[];
  recentReplies: EmailReplyPreview[];
}

interface LinkedInDashboardData {
  senders: LinkedInSenderRow[];
  liveCampaignCount: number;
  totalCampaignCount: number;
  workerOnline: boolean;
  workerLastPolledAt: Date | null;
  totals: {
    connectionsSent: number;
    connectionsAccepted: number;
    acceptanceRate: number;
    messagesSent: number;
    repliesReceived: number;
    profileViews: number;
  };
  sparklines: {
    connections: number[];
    accepted: number[];
    messages: number[];
    replies: number[];
    profileViews: number[];
  };
  activityFeed: LinkedInActivityPreview[];
}

const VALID_PERIODS = [7, 14, 30, 90] as const;

function WorkspaceAvatar({ name }: { name: string }) {
  const initial = (name || "?").charAt(0).toUpperCase();

  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-sm font-semibold text-brand-foreground shrink-0">
      {initial}
    </span>
  );
}

function formatRelativeShort(timestamp: Date, now: Date): string {
  const mins = Math.floor((now.getTime() - timestamp.getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function actionLabel(actionType: string): string {
  switch (actionType) {
    case LINKEDIN_ACTION_TYPES.MESSAGE:
      return "Message sent";
    case LINKEDIN_ACTION_TYPES.PROFILE_VIEW:
      return "Profile viewed";
    case "connect":
    case LINKEDIN_ACTION_TYPES.CONNECTION_REQUEST:
      return "Connection request sent";
    default:
      return actionType.replace(/_/g, " ");
  }
}

async function getEmailWorkspaceStats(
  apiToken: string | null | undefined,
  startDate: string,
  endDate: string,
): Promise<number> {
  if (!apiToken) return 0;

  try {
    const { EmailBisonClient } = await import("@/lib/emailbison/client");
    const ebClient = new EmailBisonClient(apiToken);
    const stats = await ebClient.getWorkspaceStats(startDate, endDate);
    return parseInt(stats.emails_sent, 10) || 0;
  } catch (err) {
    console.warn("[portal-dashboard] Failed to fetch EB workspace stats:", err);
    return 0;
  }
}

async function getEmailDashboardData(
  workspaceSlug: string,
  apiToken: string | null | undefined,
  sinceDate: Date,
  timeSeriesDays: number,
): Promise<EmailDashboardData> {
  const startDate = sinceDate.toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  const [ebPeriodSent, webhookEvents, recentReplies, periodRepliesRaw] =
    await Promise.all([
      getEmailWorkspaceStats(apiToken, startDate, endDate),
      prisma.webhookEvent.findMany({
        where: {
          workspace: workspaceSlug,
          receivedAt: { gte: sinceDate },
          eventType: {
            in: [
              "EMAIL_SENT",
              "LEAD_REPLIED",
              "LEAD_INTERESTED",
              "EMAIL_BOUNCED",
              "LEAD_UNSUBSCRIBED",
            ],
          },
          isAutomated: false,
        },
        select: {
          receivedAt: true,
          eventType: true,
        },
        orderBy: { receivedAt: "asc" },
      }),
      prisma.reply.findMany({
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
      }),
      prisma.reply.findMany({
        where: {
          workspaceSlug,
          direction: "inbound",
          receivedAt: { gte: sinceDate },
        },
        select: { receivedAt: true },
      }),
    ]);

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
      case "EMAIL_SENT":
        day.sent++;
        break;
      case "LEAD_REPLIED":
        day.replied++;
        break;
      case "LEAD_INTERESTED":
        day.interested++;
        break;
      case "EMAIL_BOUNCED":
        day.bounced++;
        break;
      case "LEAD_UNSUBSCRIBED":
        day.unsubscribed++;
        break;
    }
  }

  const performanceTimeSeries: PerformanceDayPoint[] = [];
  for (let i = timeSeriesDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    performanceTimeSeries.push(timeSeriesMap[dateStr] ?? emptyDay(dateStr));
  }

  const replyDayMap = new Map<string, number>();
  for (const r of periodRepliesRaw) {
    const key = r.receivedAt.toISOString().slice(0, 10);
    replyDayMap.set(key, (replyDayMap.get(key) ?? 0) + 1);
  }

  const replySparkline: number[] = [];
  for (let i = timeSeriesDays - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    replySparkline.push(replyDayMap.get(dateStr) ?? 0);
  }

  const webhookSent = performanceTimeSeries.reduce((sum, d) => sum + d.sent, 0);
  const periodSent = ebPeriodSent > 0 ? ebPeriodSent : webhookSent;
  const periodReplyCount = periodRepliesRaw.length;

  return {
    periodSent,
    periodReplyCount,
    periodReplyRate: periodSent > 0 ? (periodReplyCount / periodSent) * 100 : 0,
    sentSparkline: performanceTimeSeries.map((d) => d.sent),
    replySparkline,
    recentReplies,
  };
}

async function getLinkedInDashboardData(
  workspaceSlug: string,
  sinceDate: Date,
  timeSeriesDays: number,
  now: Date,
): Promise<LinkedInDashboardData> {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const senders = await prisma.sender.findMany({
    where: {
      workspaceSlug,
      channel: { in: ["linkedin", "both"] },
      status: { not: "disabled" },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      healthStatus: true,
      sessionStatus: true,
      warmupDay: true,
      proxyUrl: true,
      linkedinProfileUrl: true,
      dailyConnectionLimit: true,
      dailyMessageLimit: true,
      dailyProfileViewLimit: true,
    },
  });

  const senderIds = senders.map((sender) => sender.id);

  const sevenDayStart = new Date(todayStart);
  sevenDayStart.setDate(sevenDayStart.getDate() - (timeSeriesDays - 1));

  const [
    liveCampaignCount,
    totalCampaignCount,
    todayUsage,
    weeklyUsage,
    pendingCounts,
    pastDueCounts,
    connectionsSent,
    messagesSent,
    profileViews,
    connectionsAccepted,
    repliesReceived,
    recentHealthEvents,
    recentCompletedActions,
    recentInboundReplies,
    canonicalSender,
  ] = await Promise.all([
    prisma.campaign.count({
      where: {
        workspaceSlug,
        channels: { contains: "linkedin" },
        status: { in: ["active", "deployed"] },
      },
    }),
    prisma.campaign.count({
      where: {
        workspaceSlug,
        channels: { contains: "linkedin" },
        status: { not: "archived" },
      },
    }),
    senderIds.length > 0
      ? prisma.linkedInDailyUsage.findMany({
          where: {
            senderId: { in: senderIds },
            date: todayStart,
          },
        })
      : Promise.resolve([]),
    senderIds.length > 0
      ? prisma.linkedInDailyUsage.findMany({
          where: {
            senderId: { in: senderIds },
            date: { gte: sevenDayStart, lte: todayStart },
          },
          orderBy: { date: "asc" },
        })
      : Promise.resolve([]),
    senderIds.length > 0
      ? prisma.linkedInAction.groupBy({
          by: ["senderId"],
          where: {
            workspaceSlug,
            senderId: { in: senderIds },
            status: "pending",
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    senderIds.length > 0
      ? prisma.linkedInAction.groupBy({
          by: ["senderId"],
          where: {
            workspaceSlug,
            senderId: { in: senderIds },
            status: "pending",
            scheduledFor: { lte: now },
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    prisma.linkedInAction.count({
      where: {
        workspaceSlug,
        actionType: { in: [...CONNECTION_REQUEST_TYPES] },
        status: "complete",
        completedAt: { gte: sinceDate },
      },
    }),
    prisma.linkedInAction.count({
      where: {
        workspaceSlug,
        actionType: LINKEDIN_ACTION_TYPES.MESSAGE,
        status: "complete",
        completedAt: { gte: sinceDate },
      },
    }),
    prisma.linkedInAction.count({
      where: {
        workspaceSlug,
        actionType: LINKEDIN_ACTION_TYPES.PROFILE_VIEW,
        status: "complete",
        completedAt: { gte: sinceDate },
      },
    }),
    prisma.linkedInConnection.count({
      where: {
        status: "connected",
        connectedAt: { gte: sinceDate },
        sender: { workspaceSlug },
      },
    }),
    prisma.linkedInMessage.count({
      where: {
        isOutbound: false,
        deliveredAt: { gte: sinceDate },
        conversation: { workspaceSlug },
      },
    }),
    senderIds.length > 0
      ? prisma.senderHealthEvent.findMany({
          where: { senderId: { in: senderIds } },
          orderBy: { createdAt: "desc" },
          take: 12,
          include: {
            sender: {
              select: { name: true },
            },
          },
        })
      : Promise.resolve([]),
    prisma.linkedInAction.findMany({
      where: {
        workspaceSlug,
        status: "complete",
        completedAt: { not: null },
      },
      orderBy: { completedAt: "desc" },
      take: 12,
      select: {
        id: true,
        actionType: true,
        campaignName: true,
        completedAt: true,
        result: true,
      },
    }),
    prisma.linkedInMessage.findMany({
      where: {
        isOutbound: false,
        deliveredAt: { gte: sevenDayStart },
        conversation: { workspaceSlug },
      },
      select: { deliveredAt: true },
    }),
    getCanonicalLinkedInSender(workspaceSlug),
  ]);

  const usageMap = new Map(todayUsage.map((usage) => [usage.senderId, usage]));
  const pendingMap = new Map(
    pendingCounts.map((row) => [row.senderId, row._count._all]),
  );
  const pastDueMap = new Map(
    pastDueCounts.map((row) => [row.senderId, row._count._all]),
  );

  const senderRows: LinkedInSenderRow[] = senders.map((sender) => {
    const usage = usageMap.get(sender.id);
    return {
      id: sender.id,
      name: sender.name,
      healthStatus: sender.healthStatus,
      sessionStatus: sender.sessionStatus,
      warmupDay: sender.warmupDay,
      hasProxy: !!sender.proxyUrl,
      linkedinProfileUrl: sender.linkedinProfileUrl,
      dailyConnectionLimit: sender.dailyConnectionLimit,
      dailyMessageLimit: sender.dailyMessageLimit,
      dailyProfileViewLimit: sender.dailyProfileViewLimit,
      todayConnections: usage?.connectionsSent ?? 0,
      todayMessages: usage?.messagesSent ?? 0,
      todayViews: usage?.profileViews ?? 0,
      pendingActions: pendingMap.get(sender.id) ?? 0,
      pastDueActions: pastDueMap.get(sender.id) ?? 0,
    };
  });

  const usageByDate = new Map<
    string,
    {
      connections: number;
      accepted: number;
      messages: number;
      profileViews: number;
    }
  >();
  for (let i = 0; i < timeSeriesDays; i++) {
    const d = new Date(sevenDayStart);
    d.setDate(d.getDate() + i);
    usageByDate.set(d.toISOString().slice(0, 10), {
      connections: 0,
      accepted: 0,
      messages: 0,
      profileViews: 0,
    });
  }
  for (const row of weeklyUsage) {
    const key = row.date.toISOString().slice(0, 10);
    const existing = usageByDate.get(key);
    if (!existing) continue;
    existing.connections += row.connectionsSent;
    existing.accepted += row.connectionsAccepted;
    existing.messages += row.messagesSent;
    existing.profileViews += row.profileViews;
  }

  const repliesByDate = new Map<string, number>();
  for (const reply of recentInboundReplies) {
    const key = reply.deliveredAt.toISOString().slice(0, 10);
    repliesByDate.set(key, (repliesByDate.get(key) ?? 0) + 1);
  }

  const sortedDates = [...usageByDate.keys()].sort();
  const sparklines = {
    connections: sortedDates.map((date) => usageByDate.get(date)?.connections ?? 0),
    accepted: sortedDates.map((date) => usageByDate.get(date)?.accepted ?? 0),
    messages: sortedDates.map((date) => usageByDate.get(date)?.messages ?? 0),
    replies: sortedDates.map((date) => repliesByDate.get(date) ?? 0),
    profileViews: sortedDates.map((date) => usageByDate.get(date)?.profileViews ?? 0),
  };

  const activityFeed: LinkedInActivityPreview[] = [
    ...recentHealthEvents.map((event) => ({
      id: event.id,
      title: `${event.sender.name} · ${event.reason.replace(/_/g, " ")}`,
      detail: event.detail ?? `Status: ${event.status}`,
      timestamp: event.createdAt,
    })),
    ...recentCompletedActions.map((action) => ({
      id: action.id,
      title: actionLabel(action.actionType),
      detail: action.campaignName ? `Campaign: ${action.campaignName}` : null,
      timestamp: action.completedAt ?? now,
    })),
  ]
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 12);

  return {
    senders: senderRows,
    liveCampaignCount,
    totalCampaignCount,
    workerOnline: !!(
      canonicalSender?.lastPolledAt &&
      now.getTime() - canonicalSender.lastPolledAt.getTime() < 10 * 60 * 1000
    ),
    workerLastPolledAt: canonicalSender?.lastPolledAt ?? null,
    totals: {
      connectionsSent,
      connectionsAccepted,
      acceptanceRate:
        connectionsSent > 0
          ? Math.round((connectionsAccepted / connectionsSent) * 1000) / 10
          : 0,
      messagesSent,
      repliesReceived,
      profileViews,
    },
    sparklines,
    activityFeed,
  };
}

function buildActivityTicker(
  emailData: EmailDashboardData | null,
  linkedInData: LinkedInDashboardData | null,
): DashboardTickerItem[] {
  const items: DashboardTickerItem[] = [];

  for (const reply of emailData?.recentReplies ?? []) {
    items.push({
      id: reply.id,
      channel: "email",
      label: reply.senderName || reply.senderEmail || "New email reply",
      detail: reply.subject || reply.campaignName || "Reply received",
      timestamp: reply.receivedAt,
      href: "/portal/inbox",
    });
  }

  for (const item of linkedInData?.activityFeed ?? []) {
    items.push({
      id: item.id,
      channel: "linkedin",
      label: item.title,
      detail: item.detail,
      timestamp: item.timestamp,
      href: "/portal/activity?channel=linkedin",
    });
  }

  return items
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 5);
}

function ActivityTicker({
  items,
  now,
}: {
  items: DashboardTickerItem[];
  now: Date;
}) {
  return (
    <Card density="compact">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base text-foreground">
            Recent Activity
          </CardTitle>
          <Link
            href="/portal/activity"
            className="text-xs font-medium text-brand hover:underline"
          >
            View full activity
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Activity will appear here as your outreach runs.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <Link
                key={`${item.channel}-${item.id}`}
                href={item.href}
                className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50"
              >
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
                    item.channel === "linkedin"
                      ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                      : "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
                  }`}
                >
                  {item.channel}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.label}
                  </p>
                  {item.detail ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {item.detail}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatRelativeShort(item.timestamp, now)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmailSection({
  data,
  now,
  showSectionHeader,
}: {
  data: EmailDashboardData;
  now: Date;
  showSectionHeader: boolean;
}) {
  return (
    <div className="space-y-4">
      {showSectionHeader ? (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Email Outreach
          </p>
          <p className="text-sm text-muted-foreground">
            Replies, sent volume, and recent inbox activity.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          label="Replies"
          value={data.periodReplyCount.toLocaleString()}
          sparklineData={data.replySparkline}
          sparklineColor="#635BFF"
          density="compact"
          icon="MessageSquareText"
        />
        <MetricCard
          label="Sent"
          value={data.periodSent.toLocaleString()}
          sparklineData={data.sentSparkline}
          sparklineColor="#635BFF"
          density="compact"
          icon="Send"
        />
        <MetricCard
          label="Reply Rate"
          value={data.periodReplyRate.toFixed(1)}
          suffix="%"
          sparklineData={data.sentSparkline.map((sent, i) =>
            sent > 0 ? (data.replySparkline[i] / sent) * 100 : 0,
          )}
          sparklineColor="#635BFF"
          density="compact"
          icon="TrendingUp"
        />
      </div>

      <Card density="compact">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base text-foreground">
              Recent Replies
            </CardTitle>
            <Link
              href="/portal/inbox"
              className="text-xs font-medium text-brand hover:underline"
            >
              View all
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {data.recentReplies.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No replies yet
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.recentReplies.map((reply) => (
                <Link
                  key={reply.id}
                  href="/portal/inbox"
                  className="flex items-center gap-3 rounded px-2 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {reply.senderName || reply.senderEmail}
                      </span>
                      {reply.intent ? (
                        <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                          {reply.intent.replace(/_/g, " ")}
                        </span>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {reply.subject || reply.bodyText?.slice(0, 80) || "No subject"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatRelativeShort(reply.receivedAt, now)}
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

function LinkedInReconnectBanner({
  senders,
}: {
  senders: LinkedInSenderRow[];
}) {
  const reconnectable = senders.filter(
    (sender) => sender.sessionStatus === "expired" || sender.sessionStatus === "not_setup",
  );

  if (reconnectable.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              Reconnect your LinkedIn
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-200">
              One or more LinkedIn accounts need attention before outreach can continue normally.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {reconnectable.map((sender) => (
              <PortalConnectButton
                key={sender.id}
                senderId={sender.id}
                senderName={sender.name}
                sessionStatus={sender.sessionStatus}
                hasProxy={sender.hasProxy}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkedInSection({
  data,
  now,
  showSectionHeader,
}: {
  data: LinkedInDashboardData;
  now: Date;
  showSectionHeader: boolean;
}) {
  const hasLinkedInActivity =
    data.totals.connectionsSent > 0 ||
    data.totals.connectionsAccepted > 0 ||
    data.totals.messagesSent > 0 ||
    data.totals.repliesReceived > 0 ||
    data.totals.profileViews > 0 ||
    data.senders.some((sender) => sender.pendingActions > 0) ||
    data.activityFeed.length > 0;

  if (data.senders.length === 0) {
    return (
      <div className="space-y-4">
        {showSectionHeader ? (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              LinkedIn Outreach
            </p>
            <p className="text-sm text-muted-foreground">
              Sender health, usage, and recent LinkedIn activity.
            </p>
          </div>
        ) : null}

        <EmptyState
          icon={LinkedinIcon}
          title="Connect your LinkedIn"
          description="Add your LinkedIn account to start sending connection requests and messages. Your outreach stats will appear here once connected."
          action={{
            label: "Open LinkedIn settings",
            href: "/portal/linkedin",
          }}
          variant="card"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showSectionHeader ? (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            LinkedIn Outreach
          </p>
          <p className="text-sm text-muted-foreground">
            Sender health, usage, and recent LinkedIn activity.
          </p>
        </div>
      ) : null}

      <LinkedInReconnectBanner senders={data.senders} />

      <div
        className={`flex items-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm ${
          data.workerOnline
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        }`}
      >
        <span
          className={`inline-flex h-2 w-2 rounded-full ${
            data.workerOnline ? "bg-emerald-500" : "bg-red-500"
          }`}
        />
        <span className="font-medium">
          {data.workerOnline ? "LinkedIn worker online" : "LinkedIn worker offline"}
        </span>
        {data.workerLastPolledAt ? (
          <span className="text-xs opacity-75">
            · {formatRelativeShort(data.workerLastPolledAt, now)} ago
          </span>
        ) : null}
      </div>

      {data.totalCampaignCount === 0 ? (
        <EmptyState
          icon={LinkedinIcon}
          title="Campaigns coming soon"
          description="Your outreach will appear here as soon as your first LinkedIn campaign is ready."
          variant="card"
        />
      ) : !hasLinkedInActivity ? (
        <EmptyState
          icon={Activity}
          title="Campaigns deploying"
          description="Your first LinkedIn outreach activity will appear here as soon as campaigns begin running."
          variant="card"
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Connections Sent"
          value={data.totals.connectionsSent.toLocaleString()}
          sparklineData={data.sparklines.connections}
          sparklineColor="#635BFF"
          density="compact"
          icon="UserPlus"
        />
        <MetricCard
          label="Connections Accepted"
          value={data.totals.connectionsAccepted.toLocaleString()}
          detail={`${data.totals.acceptanceRate.toFixed(1)}% acceptance`}
          sparklineData={data.sparklines.accepted}
          sparklineColor="#16A34A"
          density="compact"
          icon="CheckCircle"
        />
        <MetricCard
          label="Messages Sent"
          value={data.totals.messagesSent.toLocaleString()}
          sparklineData={data.sparklines.messages}
          sparklineColor="#635BFF"
          density="compact"
          icon="MessageSquare"
        />
        <MetricCard
          label="Replies Received"
          value={data.totals.repliesReceived.toLocaleString()}
          sparklineData={data.sparklines.replies}
          sparklineColor="#0EA5E9"
          density="compact"
          icon="MessageSquareText"
        />
        <MetricCard
          label="Profile Views"
          value={data.totals.profileViews.toLocaleString()}
          sparklineData={data.sparklines.profileViews}
          sparklineColor="#635BFF"
          density="compact"
          icon="Eye"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">
            LinkedIn Senders
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead>Name</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="text-right">Today</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead>Session</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.senders.map((sender) => (
                <TableRow key={sender.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{sender.name}</span>
                      {sender.linkedinProfileUrl ? (
                        <a
                          href={sender.linkedinProfileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          Profile
                        </a>
                      ) : null}
                      <WarmupBadge
                        warmupDay={sender.warmupDay}
                        sessionStatus={sender.sessionStatus}
                        hasLiveCampaign={data.liveCampaignCount > 0}
                      />
                    </div>
                  </TableCell>
                  <TableCell>
                    <HealthStatusBadge status={sender.healthStatus} />
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {sender.todayConnections}/{sender.dailyConnectionLimit} c ·{" "}
                    {sender.todayMessages}/{sender.dailyMessageLimit} m ·{" "}
                    {sender.todayViews}/{sender.dailyProfileViewLimit} v
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {sender.pendingActions}
                    {sender.pastDueActions > 0 ? (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">
                        ({sender.pastDueActions} past-due)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <PortalConnectButton
                      senderId={sender.id}
                      senderName={sender.name}
                      sessionStatus={sender.sessionStatus}
                      hasProxy={sender.hasProxy}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card density="compact">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base text-foreground">
              LinkedIn Activity
            </CardTitle>
            <Link
              href="/portal/activity?channel=linkedin"
              className="text-xs font-medium text-brand hover:underline"
            >
              View full activity
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {data.activityFeed.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Activity will appear here once your LinkedIn outreach begins running.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.activityFeed.map((item) => (
                <Link
                  key={item.id}
                  href="/portal/activity?channel=linkedin"
                  className="flex items-center gap-3 rounded px-2 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    LinkedIn
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </p>
                    {item.detail ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {item.detail}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatRelativeShort(item.timestamp, now)}
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

export default async function PortalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const timeSeriesDays = VALID_PERIODS.includes(
    Number(periodParam) as (typeof VALID_PERIODS)[number],
  )
    ? Number(periodParam)
    : 14;

  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }

  const { workspaceSlug } = session;
  const workspace = await getWorkspaceDetails(workspaceSlug);

  if (!workspace) {
    return (
      <div className="p-6">
        <div className="py-12 text-center text-muted-foreground">
          Your workspace is being set up. Check back soon.
        </div>
      </div>
    );
  }

  const now = new Date();
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - timeSeriesDays);

  const { hasEmail, hasLinkedIn } = getPortalDashboardChannels(workspace);
  const dashboardMode = getPortalDashboardMode(workspace);

  const [pendingApprovalCount, emailData, linkedInData] = await Promise.all([
    prisma.campaign.count({
      where: { workspaceSlug, status: "pending_approval" },
    }),
    hasEmail
      ? getEmailDashboardData(
          workspaceSlug,
          workspace.apiToken,
          sinceDate,
          timeSeriesDays,
        )
      : Promise.resolve(null),
    hasLinkedIn
      ? getLinkedInDashboardData(workspaceSlug, sinceDate, timeSeriesDays, now)
      : Promise.resolve(null),
  ]);

  const recentActivityItems = buildActivityTicker(emailData, linkedInData);

  return (
    <div className="p-6 space-y-6">
      {pendingApprovalCount > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {pendingApprovalCount} campaign
            {pendingApprovalCount !== 1 ? "s" : ""} awaiting your approval
          </p>
          <Link
            href="/portal/campaigns"
            className="text-sm font-medium text-amber-900 underline hover:no-underline dark:text-amber-100"
          >
            Review campaigns
          </Link>
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-3">
          <WorkspaceAvatar name={workspace.name} />
          <div>
            <h1 className="text-xl font-medium text-foreground">
              {workspace.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {dashboardMode === "combined"
                ? "Email and LinkedIn outreach overview"
                : dashboardMode === "linkedin"
                  ? "LinkedIn outreach overview"
                  : "Campaign performance overview"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PeriodSelector />
          <RelativeTimestamp timestamp={now.toISOString()} />
          <PortalRefreshButton />
        </div>
      </div>

      <ActivityTicker items={recentActivityItems} now={now} />

      {dashboardMode === "email" && emailData ? (
        <EmailSection data={emailData} now={now} showSectionHeader={false} />
      ) : null}

      {dashboardMode === "linkedin" && linkedInData ? (
        <LinkedInSection
          data={linkedInData}
          now={now}
          showSectionHeader={false}
        />
      ) : null}

      {dashboardMode === "combined" ? (
        <div className="space-y-8">
          {emailData ? (
            <EmailSection data={emailData} now={now} showSectionHeader />
          ) : null}
          {linkedInData ? (
            <LinkedInSection data={linkedInData} now={now} showSectionHeader />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
