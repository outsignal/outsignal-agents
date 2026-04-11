/**
 * Trigger.dev Scheduled Task: Daily Invariant Audit
 *
 * Runs the three data integrity invariants audit once daily and posts the
 * result to #outsignal-ops Slack. This is the "prevent silent drift" piece
 * that closes the feedback loop — if any invariant starts violating again
 * (new bypass path, new data quality issue, new bug), we see it the next
 * morning in a single Slack message.
 *
 * Scheduled daily at 07:00 UTC (08:00 BST).
 *
 * The task:
 *   1. Calls runInvariantAudit() from src/lib/audit/invariants.ts
 *   2. Renders the results as a Slack message (header + table in a code block)
 *   3. Posts to OPS_SLACK_CHANNEL_ID
 *   4. Returns the audit result in the task output (visible in Trigger.dev
 *      dashboard for historical trending)
 *
 * Does NOT alter any data. Does NOT page anyone. Just reports.
 */

import { schedules } from "@trigger.dev/sdk";
import { runInvariantAudit, renderAuditTable } from "@/lib/audit/invariants";
import { postMessage } from "@/lib/slack";
import type { KnownBlock } from "@slack/web-api";

const LOG_PREFIX = "[daily-invariant-audit]";

export const dailyInvariantAuditTask = schedules.task({
  id: "daily-invariant-audit",
  cron: "0 7 * * *", // daily at 07:00 UTC
  maxDuration: 60,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    const startedAt = Date.now();
    console.log(`${LOG_PREFIX} Starting daily invariant audit`);

    const audit = await runInvariantAudit();
    const table = renderAuditTable(audit);

    const durationMs = Date.now() - startedAt;
    console.log(
      `${LOG_PREFIX} Audit complete in ${durationMs}ms: ${audit.allPass ? "PASS" : "FAIL"}`,
    );
    console.log(table);

    // Post to Slack ops channel
    const opsChannelId = process.env.OPS_SLACK_CHANNEL_ID;
    if (!opsChannelId) {
      console.warn(
        `${LOG_PREFIX} OPS_SLACK_CHANNEL_ID not set — skipping Slack post`,
      );
      return {
        audit,
        slackPosted: false,
        slackSkipReason: "OPS_SLACK_CHANNEL_ID not configured",
      };
    }

    const headerEmoji = audit.allPass ? "✅" : "⚠️";
    const headerText = `${headerEmoji} Daily invariant audit — ${audit.allPass ? "PASS" : "FAIL"}`;
    const summaryLine = audit.allPass
      ? `All ${audit.totals.totalLeads.toLocaleString()} active-workspace leads pass INV1/INV2/INV3`
      : `INV1: ${audit.totals.inv1Violations} · INV2: ${audit.totals.inv2Violations} · INV3: ${audit.totals.inv3Violations} violations across ${audit.totals.totalLeads.toLocaleString()} active-workspace leads`;

    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: headerText, emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: summaryLine },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "```\n" + table + "\n```" },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Generated at ${audit.generatedAt} · INV1=email integrity · INV2=scoring coverage · INV3=staging path`,
          },
        ],
      },
    ];

    try {
      await postMessage(opsChannelId, headerText, blocks);
      console.log(`${LOG_PREFIX} Slack notification posted to ${opsChannelId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${LOG_PREFIX} Slack post failed: ${msg}`);
      return {
        audit,
        slackPosted: false,
        slackSkipReason: `post failed: ${msg}`,
      };
    }

    return {
      audit,
      slackPosted: true,
      durationMs,
    };
  },
});
