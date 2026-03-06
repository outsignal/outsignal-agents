import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { EmailBisonClient } from "@/lib/emailbison/client";

export const dynamic = "force-dynamic";

export interface DashboardKPIs {
  // Email KPIs
  emailSent: number;
  emailOpened: number;
  emailReplied: number;
  emailInterested: number;
  emailBounced: number;
  // LinkedIn KPIs
  linkedinConnect: number;
  linkedinMessage: number;
  linkedinProfileView: number;
  linkedinPending: number;
  linkedinFailed: number;
  // Pipeline KPIs
  pipelineContacted: number;
  pipelineReplied: number;
  pipelineInterested: number;
  // Health KPIs
  sendersHealthy: number;
  sendersWarning: number;
  sendersPaused: number;
  sendersBlocked: number;
  sendersSessionExpired: number;
  sendersActiveTotal: number;
  // LinkedIn Account Health
  linkedinAccountsActive: number;
  linkedinAccountsExpired: number;
  linkedinAccountsTotal: number;
  campaignsActive: number;
  campaignsPaused: number;
  campaignsDraft: number;
  // Inbox KPIs (sender email accounts from EmailBison)
  inboxesActive: number;
  inboxesTotal: number;
  inboxesIssues: number;
  // Worker status
  workerOnline: boolean;
  workerLastPollAt: string | null;
}

export interface TimeSeriesPoint {
  date: string;
  sent: number;
  replies: number;
  bounces: number;
  opens: number;
}

export interface LinkedInTimeSeriesPoint {
  date: string;
  connections: number;
  messages: number;
  profileViews: number;
  failed: number;
}

export interface DashboardAlert {
  type: "flagged_sender" | "failed_agent_run" | "disconnected_inbox" | "disconnected_linkedin";
  title: string;
  detail: string;
  link?: string;
  severity: "warning" | "error";
}

export interface WorkspaceOption {
  slug: string;
  name: string;
}

export interface DashboardStatsResponse {
  kpis: DashboardKPIs;
  timeSeries: TimeSeriesPoint[];
  linkedInTimeSeries: LinkedInTimeSeriesPoint[];
  alerts: DashboardAlert[];
  workspaces: WorkspaceOption[];
}

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const workspaceFilter = searchParams.get("workspace") ?? "all";
  const daysParam = parseInt(searchParams.get("days") ?? "7", 10);
  const days = [7, 14, 30, 90].includes(daysParam) ? daysParam : 7;

  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);

  const wsFilter =
    workspaceFilter !== "all" ? { workspace: workspaceFilter } : {};
  const wsFilterSlug =
    workspaceFilter !== "all" ? { workspaceSlug: workspaceFilter } : {};

  try {
    // 1. Email KPIs from WebhookEvent
    const emailEvents = await prisma.webhookEvent.groupBy({
      by: ["eventType"],
      where: {
        ...wsFilter,
        receivedAt: { gte: sinceDate },
      },
      _count: { eventType: true },
    });

    const emailMap: Record<string, number> = {};
    for (const ev of emailEvents) {
      emailMap[ev.eventType] = ev._count.eventType;
    }

    // 2. LinkedIn KPIs from LinkedInAction
    const linkedInByType = await prisma.linkedInAction.groupBy({
      by: ["actionType"],
      where: {
        ...wsFilterSlug,
        createdAt: { gte: sinceDate },
      },
      _count: { actionType: true },
    });

    const linkedInByStatus = await prisma.linkedInAction.groupBy({
      by: ["status"],
      where: {
        ...wsFilterSlug,
        createdAt: { gte: sinceDate },
      },
      _count: { status: true },
    });

    const linkedInTypeMap: Record<string, number> = {};
    for (const item of linkedInByType) {
      linkedInTypeMap[item.actionType] = item._count.actionType;
    }

    const linkedInStatusMap: Record<string, number> = {};
    for (const item of linkedInByStatus) {
      linkedInStatusMap[item.status] = item._count.status;
    }

    // 3. Pipeline KPIs from PersonWorkspace
    const pipelineFilter = workspaceFilter !== "all"
      ? { workspace: workspaceFilter }
      : {};
    const pipelineStats = await prisma.personWorkspace.groupBy({
      by: ["status"],
      where: pipelineFilter,
      _count: { status: true },
    });

    const pipelineMap: Record<string, number> = {};
    for (const item of pipelineStats) {
      pipelineMap[item.status] = item._count.status;
    }

    // 4. Health KPIs: Sender health/session status
    const senderHealthStats = await prisma.sender.groupBy({
      by: ["healthStatus"],
      where: wsFilterSlug,
      _count: { healthStatus: true },
    });

    const senderHealthMap: Record<string, number> = {};
    for (const item of senderHealthStats) {
      senderHealthMap[item.healthStatus] = item._count.healthStatus;
    }

    // LinkedIn session health (senders with LinkedIn profiles)
    const linkedinSessionStats = await prisma.sender.groupBy({
      by: ["sessionStatus"],
      where: {
        ...wsFilterSlug,
        linkedinProfileUrl: { not: null },
      },
      _count: { sessionStatus: true },
    });

    const linkedinSessionMap: Record<string, number> = {};
    for (const item of linkedinSessionStats) {
      linkedinSessionMap[item.sessionStatus] = item._count.sessionStatus;
    }

    // 5. Campaign active/paused/draft counts
    const campaignStats = await prisma.campaign.groupBy({
      by: ["status"],
      where: wsFilterSlug,
      _count: { status: true },
    });

    const campaignMap: Record<string, number> = {};
    for (const item of campaignStats) {
      campaignMap[item.status] = item._count.status;
    }

    // 6. Inbox KPIs: fetch sender emails from EmailBison across all workspaces
    const allWorkspaces = await prisma.workspace.findMany({
      select: { slug: true, name: true, apiToken: true, status: true },
    });

    const workspacesWithToken = allWorkspaces.filter((w) => w.apiToken);
    const filteredWsForInbox =
      workspaceFilter !== "all"
        ? workspacesWithToken.filter((w) => w.slug === workspaceFilter)
        : workspacesWithToken;

    const senderEmailResults = await Promise.allSettled(
      filteredWsForInbox.map(async (ws) => {
        const client = new EmailBisonClient(ws.apiToken as string);
        return client.getSenderEmails();
      })
    );

    let inboxesTotal = 0;
    let inboxesActive = 0;
    let inboxesIssues = 0;
    for (const result of senderEmailResults) {
      if (result.status === "fulfilled") {
        const senders = result.value;
        inboxesTotal += senders.length;
        for (const s of senders) {
          const status = (s.status ?? "").toLowerCase();
          if (status === "connected" || status === "active") {
            inboxesActive++;
          } else {
            inboxesIssues++;
          }
        }
      }
      // Failed requests are silently skipped — they don't break the dashboard
    }

    // Worker heartbeat: most recently polled sender
    const latestPoll = await prisma.sender.findFirst({
      where: workspaceFilter !== "all" ? { workspaceSlug: workspaceFilter } : undefined,
      orderBy: { lastPolledAt: "desc" },
      select: { lastPolledAt: true },
    });
    const workerLastPollAt = latestPoll?.lastPolledAt ?? null;
    const workerOnline = workerLastPollAt
      ? Date.now() - new Date(workerLastPollAt).getTime() < 10 * 60 * 1000
      : false;

    // 7. Time-series data from WebhookEvent grouped by date
    const webhookEvents = await prisma.webhookEvent.findMany({
      where: {
        ...wsFilter,
        receivedAt: { gte: sinceDate },
        eventType: {
          in: ["EMAIL_SENT", "EMAIL_OPENED", "LEAD_REPLIED", "LEAD_INTERESTED", "BOUNCE"],
        },
      },
      select: {
        receivedAt: true,
        eventType: true,
      },
      orderBy: { receivedAt: "asc" },
    });

    // Group by date
    const timeSeriesMap: Record<string, TimeSeriesPoint> = {};
    for (const event of webhookEvents) {
      const dateStr = event.receivedAt.toISOString().slice(0, 10);
      if (!timeSeriesMap[dateStr]) {
        timeSeriesMap[dateStr] = { date: dateStr, sent: 0, replies: 0, bounces: 0, opens: 0 };
      }
      if (event.eventType === "EMAIL_SENT") timeSeriesMap[dateStr].sent++;
      else if (event.eventType === "EMAIL_OPENED") timeSeriesMap[dateStr].opens++;
      else if (event.eventType === "LEAD_REPLIED") timeSeriesMap[dateStr].replies++;
      else if (event.eventType === "LEAD_INTERESTED") timeSeriesMap[dateStr].replies++;
      else if (event.eventType === "BOUNCE") timeSeriesMap[dateStr].bounces++;
    }

    // Fill in all days in range (including zeros)
    const timeSeries: TimeSeriesPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      timeSeries.push(timeSeriesMap[dateStr] ?? { date: dateStr, sent: 0, replies: 0, bounces: 0, opens: 0 });
    }

    // 7b. LinkedIn time-series data from LinkedInAction grouped by date
    const linkedInActions = await prisma.linkedInAction.findMany({
      where: {
        ...wsFilterSlug,
        createdAt: { gte: sinceDate },
      },
      select: {
        createdAt: true,
        actionType: true,
        status: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const linkedInTsMap: Record<string, LinkedInTimeSeriesPoint> = {};
    for (const action of linkedInActions) {
      const dateStr = action.createdAt.toISOString().slice(0, 10);
      if (!linkedInTsMap[dateStr]) {
        linkedInTsMap[dateStr] = { date: dateStr, connections: 0, messages: 0, profileViews: 0, failed: 0 };
      }
      if (action.status === "failed") {
        linkedInTsMap[dateStr].failed++;
      } else if (action.actionType === "connect") {
        linkedInTsMap[dateStr].connections++;
      } else if (action.actionType === "message") {
        linkedInTsMap[dateStr].messages++;
      } else if (action.actionType === "profile_view") {
        linkedInTsMap[dateStr].profileViews++;
      }
    }

    // Fill in all days for LinkedIn
    const linkedInTimeSeries: LinkedInTimeSeriesPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      linkedInTimeSeries.push(linkedInTsMap[dateStr] ?? { date: dateStr, connections: 0, messages: 0, profileViews: 0, failed: 0 });
    }

    // 8. Alerts
    const alerts: DashboardAlert[] = [];

    // Flagged senders (not healthy)
    const flaggedSenders = await prisma.sender.findMany({
      where: {
        ...wsFilterSlug,
        healthStatus: { not: "healthy" },
      },
      select: { id: true, name: true, healthStatus: true, workspaceSlug: true },
      take: 10,
    });
    for (const sender of flaggedSenders) {
      alerts.push({
        type: "flagged_sender",
        title: `Sender flagged: ${sender.name}`,
        detail: `Health status: ${sender.healthStatus} — workspace: ${sender.workspaceSlug}`,
        link: `/senders`,
        severity: sender.healthStatus === "blocked" || sender.healthStatus === "session_expired" ? "error" : "warning",
      });
    }

    // Failed agent runs in last 24h
    const failedRuns = await prisma.agentRun.findMany({
      where: {
        ...wsFilterSlug,
        status: "failed",
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      select: { id: true, agent: true, workspaceSlug: true, error: true, createdAt: true },
      take: 10,
      orderBy: { createdAt: "desc" },
    });
    for (const run of failedRuns) {
      alerts.push({
        type: "failed_agent_run",
        title: `Agent run failed: ${run.agent}`,
        detail: run.error
          ? run.error.slice(0, 100)
          : `Workspace: ${run.workspaceSlug ?? "unknown"}`,
        severity: "error",
      });
    }

    // Disconnected inboxes (active workspaces with no apiToken)
    const disconnectedWorkspaces = allWorkspaces.filter(
      (w) => !w.apiToken && w.status === "active"
    );
    for (const ws of disconnectedWorkspaces) {
      alerts.push({
        type: "disconnected_inbox",
        title: `Inbox disconnected: ${ws.name}`,
        detail: "No EmailBison API token configured for this workspace.",
        link: `/workspace/${ws.slug}/settings`,
        severity: "warning",
      });
    }

    // Expired LinkedIn sessions
    const expiredLinkedIn = await prisma.sender.findMany({
      where: {
        ...wsFilterSlug,
        linkedinProfileUrl: { not: null },
        sessionStatus: "expired",
      },
      select: { id: true, name: true, workspaceSlug: true },
      take: 10,
    });
    for (const sender of expiredLinkedIn) {
      alerts.push({
        type: "disconnected_linkedin",
        title: `LinkedIn disconnected: ${sender.name}`,
        detail: `Session expired — workspace: ${sender.workspaceSlug}`,
        link: `/senders`,
        severity: "warning",
      });
    }

    // Build KPIs
    const kpis: DashboardKPIs = {
      emailSent: emailMap["EMAIL_SENT"] ?? 0,
      emailOpened: emailMap["EMAIL_OPENED"] ?? 0,
      emailReplied: emailMap["LEAD_REPLIED"] ?? 0,
      emailInterested: emailMap["LEAD_INTERESTED"] ?? 0,
      emailBounced: emailMap["BOUNCE"] ?? 0,
      linkedinConnect: linkedInTypeMap["connect"] ?? 0,
      linkedinMessage: linkedInTypeMap["message"] ?? 0,
      linkedinProfileView: linkedInTypeMap["profile_view"] ?? 0,
      linkedinPending: linkedInStatusMap["pending"] ?? 0,
      linkedinFailed: linkedInStatusMap["failed"] ?? 0,
      pipelineContacted: pipelineMap["contacted"] ?? 0,
      pipelineReplied: pipelineMap["replied"] ?? 0,
      pipelineInterested: pipelineMap["interested"] ?? 0,
      sendersHealthy: senderHealthMap["healthy"] ?? 0,
      sendersWarning: senderHealthMap["warning"] ?? 0,
      sendersPaused: senderHealthMap["paused"] ?? 0,
      sendersBlocked: senderHealthMap["blocked"] ?? 0,
      sendersSessionExpired: senderHealthMap["session_expired"] ?? 0,
      sendersActiveTotal:
        (senderHealthMap["healthy"] ?? 0) + (senderHealthMap["warning"] ?? 0),
      linkedinAccountsActive: linkedinSessionMap["active"] ?? 0,
      linkedinAccountsExpired: linkedinSessionMap["expired"] ?? 0,
      linkedinAccountsTotal: Object.values(linkedinSessionMap).reduce((a, b) => a + b, 0),
      campaignsActive: campaignMap["active"] ?? 0,
      campaignsPaused: campaignMap["paused"] ?? 0,
      campaignsDraft: campaignMap["draft"] ?? 0,
      inboxesActive,
      inboxesTotal,
      inboxesIssues,
      workerOnline,
      workerLastPollAt: workerLastPollAt?.toISOString() ?? null,
    };

    // Workspace list for filter dropdown
    const workspaces: WorkspaceOption[] = allWorkspaces.map((w) => ({
      slug: w.slug,
      name: w.name,
    }));

    const response: DashboardStatsResponse = {
      kpis,
      timeSeries,
      linkedInTimeSeries,
      alerts,
      workspaces,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[dashboard/stats] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 }
    );
  }
}
