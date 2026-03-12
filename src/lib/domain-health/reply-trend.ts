/**
 * Reply rate trend detection.
 *
 * Compares recent reply volume against a previous window to detect declining
 * reply rates — an early deliverability warning signal.
 *
 * Uses Reply records (workspaceSlug + receivedAt) — no sent-count dependency.
 * When reply volume drops significantly it often indicates inbox placement
 * issues, domain reputation problems, or content being flagged as spam.
 */

import { prisma } from "@/lib/db";
import { postMessage } from "@/lib/slack";
import { audited } from "@/lib/notification-audit";
import { verifySlackChannel } from "@/lib/notification-guard";
import type { KnownBlock } from "@slack/web-api";

const LOG_PREFIX = "[reply-trend]";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplyTrendResult {
  workspaceSlug: string;
  workspaceName: string;
  trend: "declining" | "improving" | "stable";
  recentCount: number;
  previousCount: number;
  changePercent: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of days in each comparison window */
const WINDOW_DAYS = 3;

/** Minimum replies in the previous window to trigger an alert (avoids noise on low-volume workspaces) */
const MIN_PREVIOUS_REPLIES = 3;

/** Percentage drop threshold to classify as "declining" */
const DECLINE_THRESHOLD_PCT = 30;

/** Percentage increase threshold to classify as "improving" */
const IMPROVE_THRESHOLD_PCT = 30;

// ---------------------------------------------------------------------------
// Core detection
// ---------------------------------------------------------------------------

/**
 * Detect reply volume trend for a single workspace.
 *
 * Compares the reply count in the last `WINDOW_DAYS` days against the
 * preceding `WINDOW_DAYS` days. Returns trend classification and counts.
 */
export async function detectReplyTrend(
  workspaceSlug: string,
  workspaceName: string,
): Promise<ReplyTrendResult> {
  const now = new Date();

  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - WINDOW_DAYS);

  const previousStart = new Date(recentStart);
  previousStart.setDate(previousStart.getDate() - WINDOW_DAYS);

  const [recentCount, previousCount] = await Promise.all([
    prisma.reply.count({
      where: {
        workspaceSlug,
        receivedAt: { gte: recentStart, lt: now },
      },
    }),
    prisma.reply.count({
      where: {
        workspaceSlug,
        receivedAt: { gte: previousStart, lt: recentStart },
      },
    }),
  ]);

  let trend: "declining" | "improving" | "stable" = "stable";
  let changePercent = 0;

  if (previousCount > 0) {
    changePercent = Math.round(
      ((recentCount - previousCount) / previousCount) * 100,
    );

    if (changePercent <= -DECLINE_THRESHOLD_PCT) {
      trend = "declining";
    } else if (changePercent >= IMPROVE_THRESHOLD_PCT) {
      trend = "improving";
    }
  } else if (recentCount > 0) {
    // Had zero replies before, now have some — improving
    trend = "improving";
    changePercent = 100;
  }
  // Both zero → stable (no data)

  return {
    workspaceSlug,
    workspaceName,
    trend,
    recentCount,
    previousCount,
    changePercent,
  };
}

// ---------------------------------------------------------------------------
// Run across all active workspaces
// ---------------------------------------------------------------------------

export interface ReplyTrendMonitorResult {
  checked: number;
  declining: ReplyTrendResult[];
  improving: ReplyTrendResult[];
  stable: number;
}

/**
 * Check reply trends for all active workspaces.
 * Returns only workspaces where the previous window had enough data to be meaningful.
 */
export async function runReplyTrendMonitor(): Promise<ReplyTrendMonitorResult> {
  const workspaces = await prisma.workspace.findMany({
    where: { status: "active" },
    select: { slug: true, name: true },
  });

  const results: ReplyTrendResult[] = [];

  for (const ws of workspaces) {
    const result = await detectReplyTrend(ws.slug, ws.name);

    // Only include workspaces that had enough replies in the previous window
    if (result.previousCount >= MIN_PREVIOUS_REPLIES || result.recentCount >= MIN_PREVIOUS_REPLIES) {
      results.push(result);
    }
  }

  const declining = results.filter((r) => r.trend === "declining");
  const improving = results.filter((r) => r.trend === "improving");
  const stable = results.filter((r) => r.trend === "stable").length;

  return {
    checked: workspaces.length,
    declining,
    improving,
    stable,
  };
}

// ---------------------------------------------------------------------------
// Slack notification
// ---------------------------------------------------------------------------

function getAlertsChannelId(): string | null {
  return process.env.ALERTS_SLACK_CHANNEL_ID ?? null;
}

/**
 * Send a Slack alert for a declining reply trend.
 */
export async function notifyReplyTrendDecline(
  result: ReplyTrendResult,
): Promise<void> {
  const alertsChannelId = getAlertsChannelId();
  if (!alertsChannelId) {
    console.warn(`${LOG_PREFIX} ALERTS_SLACK_CHANNEL_ID not set, skipping notification`);
    return;
  }

  if (!verifySlackChannel(alertsChannelId, "admin", "notifyReplyTrendDecline")) {
    return;
  }

  const headerText = `:warning: Reply Rate Declining: ${result.workspaceName}`;

  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `Reply Rate Declining: ${result.workspaceName}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Workspace:* ${result.workspaceName} (\`${result.workspaceSlug}\`)\n` +
          `*Last ${WINDOW_DAYS} days:* ${result.recentCount} replies\n` +
          `*Previous ${WINDOW_DAYS} days:* ${result.previousCount} replies\n` +
          `*Change:* :chart_with_downwards_trend: ${result.changePercent}%`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":mag: *Possible causes:* inbox placement issues, domain reputation decline, content flagged as spam, or reduced campaign volume.",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Checked at ${new Date().toUTCString()}`,
        },
      ],
    },
  ];

  try {
    await audited(
      {
        notificationType: "reply_trend_decline",
        channel: "slack",
        recipient: alertsChannelId,
        metadata: {
          workspaceSlug: result.workspaceSlug,
          recentCount: result.recentCount,
          previousCount: result.previousCount,
          changePercent: result.changePercent,
        },
      },
      () => postMessage(alertsChannelId, headerText, blocks),
    );
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Failed to send Slack notification for ${result.workspaceSlug}:`,
      err,
    );
  }
}
