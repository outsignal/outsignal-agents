/**
 * Trigger.dev Scheduled Task: Daily Claude Code Usage Report
 *
 * Posts a daily summary of Claude Code token usage to the #outsignal-ops
 * Slack channel. Runs at 09:00 UTC each morning.
 *
 * Reports both 5-hour rolling usage (matching the budget window) and
 * 24-hour total usage. Skips posting if there was zero activity.
 */

import { schedules } from "@trigger.dev/sdk";
import {
  getBudgetSnapshot,
  getUsageSnapshot,
} from "@/lib/rate-limits/tracker";
import { postMessage } from "@/lib/slack";

const LOG_PREFIX = "[daily-usage-report]";

function formatTokens(weight: number): string {
  if (weight >= 1_000_000) {
    return `${(weight / 1_000_000).toFixed(1)}M`;
  }
  if (weight >= 1_000) {
    return `${(weight / 1_000).toFixed(1)}K`;
  }
  return `${Math.round(weight)}`;
}

function getStatus(percentageUsed: number): string {
  if (percentageUsed >= 80) return "CRITICAL";
  if (percentageUsed >= 50) return "WARNING";
  return "OK";
}

function getStatusEmoji(status: string): string {
  if (status === "CRITICAL") return "\u{1F6A8}";
  if (status === "WARNING") return "\u26A0\uFE0F";
  return "\u2705";
}

export const dailyUsageReportTask = schedules.task({
  id: "daily-usage-report",
  cron: "0 9 * * *", // daily at 09:00 UTC
  maxDuration: 30,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    const timestamp = new Date().toISOString();
    console.log(`${LOG_PREFIX} Starting daily usage report at ${timestamp}`);

    // Get 5-hour rolling snapshot (uses existing cached logic)
    const snapshot5h = await getBudgetSnapshot();

    // Get 24-hour snapshot
    const snapshot24h = await getUsageSnapshot(24);

    // Skip if no activity in 24h
    if (snapshot24h.totalWeight === 0) {
      console.log(`${LOG_PREFIX} No activity in last 24h, skipping report`);
      return { posted: false, reason: "no_activity" };
    }

    // Find top session by token usage in 24h window
    const sessions24h = Object.entries(snapshot24h.bySession);
    const sessionCount = sessions24h.length;

    let topSessionId = "";
    let topSessionTokens = 0;
    for (const [sid, weight] of sessions24h) {
      if (weight > topSessionTokens) {
        topSessionId = sid;
        topSessionTokens = weight;
      }
    }

    const status = getStatus(snapshot5h.percentageUsed);
    const statusEmoji = getStatusEmoji(status);

    const message = [
      "\u{1F4CA} *Daily Claude Code Usage Report*",
      "",
      `5h rolling: ${formatTokens(snapshot5h.totalWeight)} tokens (${snapshot5h.percentageUsed.toFixed(1)}%)`,
      `24h total: ${formatTokens(snapshot24h.totalWeight)} tokens`,
      `Sessions: ${sessionCount}`,
      topSessionId
        ? `Top session: \`${topSessionId.slice(0, 8)}...\` (${formatTokens(topSessionTokens)} tokens)`
        : "",
      "",
      `${statusEmoji} Status: ${status}`,
    ]
      .filter(Boolean)
      .join("\n");

    // Post to #outsignal-ops
    const channelId = process.env.OPS_SLACK_CHANNEL_ID;
    if (!channelId) {
      console.warn(`${LOG_PREFIX} OPS_SLACK_CHANNEL_ID not set, skipping Slack post`);
      return { posted: false, reason: "no_channel_id" };
    }

    try {
      await postMessage(channelId, message);
      console.log(`${LOG_PREFIX} Posted usage report to Slack`);
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Failed to post to Slack: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err; // re-throw to trigger retry
    }

    return {
      posted: true,
      usage5h: {
        tokens: snapshot5h.totalWeight,
        percentage: snapshot5h.percentageUsed,
      },
      usage24h: {
        tokens: snapshot24h.totalWeight,
        sessions: sessionCount,
      },
      topSession: topSessionId
        ? { id: topSessionId.slice(0, 8), tokens: topSessionTokens }
        : null,
      status,
    };
  },
});
