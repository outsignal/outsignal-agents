import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Global Slack channels from env vars
  const alertsId = process.env.ALERTS_SLACK_CHANNEL_ID ?? null;
  const repliesId = process.env.REPLIES_SLACK_CHANNEL_ID ?? null;
  const opsId = process.env.OPS_SLACK_CHANNEL_ID ?? null;

  const globalChannels = {
    alerts: { channelId: alertsId, configured: !!alertsId },
    replies: { channelId: repliesId, configured: !!repliesId },
    ops: { channelId: opsId, configured: !!opsId },
  };

  // Per-workspace notification config
  const workspaces = await prisma.workspace.findMany({
    where: { status: "active" },
    select: {
      slug: true,
      name: true,
      slackChannelId: true,
      notificationEmails: true,
      approvalsSlackChannelId: true,
    },
    orderBy: { name: "asc" },
  });

  const workspaceConfigs = workspaces.map((ws) => {
    const missingConfig: string[] = [];
    if (!ws.slackChannelId) missingConfig.push("slackChannelId");

    // notificationEmails is a JSON string array — check if empty/null
    let emails: string[] = [];
    if (ws.notificationEmails) {
      try {
        emails = JSON.parse(ws.notificationEmails);
      } catch {
        emails = [];
      }
    }
    if (emails.length === 0) missingConfig.push("notificationEmails");

    return {
      slug: ws.slug,
      name: ws.name,
      slackChannelId: ws.slackChannelId,
      notificationEmails: emails,
      approvalsSlackChannelId: ws.approvalsSlackChannelId,
      missingConfig,
    };
  });

  return NextResponse.json({
    globalChannels,
    workspaces: workspaceConfigs,
  });
}
