import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { runBounceMonitor, replaceSender } from "@/lib/domain-health/bounce-monitor";
import {
  notifySenderHealthTransition,
  sendSenderHealthDigestEmail,
  notifyBounceRateTrend,
} from "@/lib/domain-health/bounce-notifications";
import type { SenderHealthDigestItem } from "@/lib/domain-health/bounce-notifications";
import { detectBounceRateTrend, shouldAlertOnTrend } from "@/lib/domain-health/trend-detection";
import { runReplyTrendMonitor, notifyReplyTrendDecline } from "@/lib/domain-health/reply-trend";

// PrismaClient at module scope — not inside run()
const prisma = new PrismaClient();

const LOG_PREFIX = "[bounce-monitor]";

export const bounceMonitorTask = schedules.task({
  id: "bounce-monitor",
  cron: "5 */4 * * *", // every 4 hours at :05 (staggered to avoid collisions)
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async () => {
    const timestamp = new Date().toISOString();
    console.log(`${LOG_PREFIX} Starting bounce monitor run at ${timestamp}`);

    // 1. Run the state machine across all active senders
    const result = await runBounceMonitor();

    // 2. Send notifications for each transition (gated here — no repeats for sustained states)
    //    Slack fires immediately per-sender; email is collected and sent as one digest.
    const digestItems: SenderHealthDigestItem[] = [];

    for (const transition of result.transitions) {
      try {
        // For critical transitions, find a replacement sender in the same workspace
        let replacementEmail: string | null = null;
        if (transition.to === "critical") {
          try {
            const replacement = await replaceSender({
              criticalSender: {
                id: "", // runBounceMonitor does not expose id; replaceSender finds by workspaceSlug
                emailAddress: transition.senderEmail,
                workspaceSlug: transition.workspaceSlug,
              },
            });
            replacementEmail = replacement.replacementEmail;
          } catch (replErr) {
            console.error(
              `${LOG_PREFIX} Failed to find replacement for ${transition.senderEmail}:`,
              replErr,
            );
          }
        }

        // Slack fires immediately; email skipped (batched into digest below)
        await notifySenderHealthTransition({
          senderEmail: transition.senderEmail,
          workspaceSlug: transition.workspaceSlug,
          fromStatus: transition.from,
          toStatus: transition.to,
          reason: transition.reason,
          action: transition.action,
          replacementEmail,
          skipEmail: true,
        });

        // Collect for digest email
        digestItems.push({
          senderEmail: transition.senderEmail,
          workspaceSlug: transition.workspaceSlug,
          fromStatus: transition.from,
          toStatus: transition.to,
          reason: transition.reason,
          action: transition.action,
          bouncePct: transition.bouncePct ?? undefined,
          replacementEmail,
        });

        // Auto-create deliverability insight for warning/critical transitions
        if (transition.to === "warning" || transition.to === "critical") {
          try {
            // Dedup check: skip if an active deliverability insight already exists for this sender/status
            const existing = await prisma.insight.findFirst({
              where: {
                category: "deliverability",
                status: "active",
                workspaceSlug: transition.workspaceSlug,
                observation: { contains: transition.senderEmail },
              },
              select: { id: true },
            });

            if (!existing) {
              const dedupKey = `deliverability:${transition.to === "critical" ? "pause_sender" : "flag_copy_review"}:${transition.senderEmail}`;
              await prisma.insight.create({
                data: {
                  category: "deliverability",
                  observation: `Sender ${transition.senderEmail} has reached ${transition.to} status — ${transition.reason}`,
                  evidence: JSON.stringify([
                    { metric: "senderEmail", value: transition.senderEmail, change: null },
                    { metric: "fromStatus", value: transition.from, change: null },
                    { metric: "toStatus", value: transition.to, change: transition.to },
                    { metric: "reason", value: transition.reason, change: null },
                  ]),
                  actionType: transition.to === "critical" ? "pause_sender" : "flag_copy_review",
                  actionDescription:
                    transition.to === "critical"
                      ? `Consider pausing ${transition.senderEmail} — bounce rate exceeds critical threshold`
                      : `Monitor ${transition.senderEmail} closely — bounce rate is elevated`,
                  status: "active",
                  workspaceSlug: transition.workspaceSlug,
                  priority: transition.to === "critical" ? 1 : 2,
                  confidence: "high",
                  dedupKey,
                },
              });
              console.log(
                `${LOG_PREFIX} Created deliverability insight for ${transition.senderEmail} → ${transition.to}`,
              );
            } else {
              console.log(
                `${LOG_PREFIX} Skipped duplicate deliverability insight for ${transition.senderEmail} → ${transition.to}`,
              );
            }
          } catch (insightErr) {
            // Insight failure must not break the task
            console.error(
              `${LOG_PREFIX} Failed to create deliverability insight for ${transition.senderEmail}:`,
              insightErr,
            );
          }
        }
      } catch (notifErr) {
        console.error(
          `${LOG_PREFIX} Failed to notify for transition ${transition.senderEmail} → ${transition.to}:`,
          notifErr,
        );
      }
    }

    // 3. Bounce rate trend detection — early warning for rising rates
    //    Run across ALL active senders (not just those that transitioned).
    let trendAlerts = 0;
    try {
      const activeSenders = await prisma.sender.findMany({
        where: {
          emailAddress: { not: null },
          status: { not: "disabled" },
          workspace: { monitoringEnabled: true },
        },
        select: {
          emailAddress: true,
          workspaceSlug: true,
          workspace: { select: { name: true } },
        },
      });

      for (const sender of activeSenders) {
        const email = sender.emailAddress as string;
        const domain = email.split("@")[1] ?? "";

        try {
          const trendResult = await detectBounceRateTrend(email);

          if (shouldAlertOnTrend(trendResult)) {
            await notifyBounceRateTrend({
              senderEmail: email,
              senderDomain: domain,
              workspaceName: sender.workspace.name,
              currentRate: trendResult.currentRate,
              previousRate: trendResult.previousRate,
              changePercent: trendResult.changePercent,
              skipEmail: true,
            });
            trendAlerts++;
          }
        } catch (trendErr) {
          console.error(`${LOG_PREFIX} Trend detection failed for ${email}:`, trendErr);
        }
      }

      if (trendAlerts > 0) {
        console.log(`${LOG_PREFIX} Sent ${trendAlerts} bounce rate trend alert(s)`);
      }
    } catch (trendQueryErr) {
      console.error(`${LOG_PREFIX} Failed to run trend detection:`, trendQueryErr);
    }

    // 4. Reply volume trend detection — early warning for declining reply rates
    //    Compares reply counts over rolling 3-day windows per workspace.
    let replyTrendAlerts = 0;
    try {
      const replyTrendResult = await runReplyTrendMonitor();

      for (const declining of replyTrendResult.declining) {
        try {
          await notifyReplyTrendDecline(declining);
          replyTrendAlerts++;
        } catch (notifErr) {
          console.error(
            `${LOG_PREFIX} Failed to send reply trend alert for ${declining.workspaceSlug}:`,
            notifErr,
          );
        }
      }

      if (replyTrendAlerts > 0) {
        console.log(`${LOG_PREFIX} Sent ${replyTrendAlerts} reply trend decline alert(s)`);
      }
      console.log(
        `${LOG_PREFIX} Reply trends: ${replyTrendResult.checked} checked, ${replyTrendResult.declining.length} declining, ${replyTrendResult.improving.length} improving, ${replyTrendResult.stable} stable`,
      );
    } catch (replyTrendErr) {
      console.error(`${LOG_PREFIX} Failed to run reply trend monitor:`, replyTrendErr);
    }

    // 5. Send one combined digest email for all transitions
    if (digestItems.length > 0) {
      try {
        await sendSenderHealthDigestEmail(digestItems);
        console.log(
          `${LOG_PREFIX} Sent sender health digest email covering ${digestItems.length} transition(s)`,
        );
      } catch (digestErr) {
        console.error(`${LOG_PREFIX} Failed to send sender health digest email:`, digestErr);
      }
    }

    console.log(
      `${LOG_PREFIX} Evaluated ${result.evaluated}, transitioned ${result.transitioned}, skipped ${result.skipped}, bounceTrendAlerts ${trendAlerts}, replyTrendAlerts ${replyTrendAlerts}`,
    );

    return {
      evaluated: result.evaluated,
      transitioned: result.transitioned,
      skipped: result.skipped,
      trendAlerts,
      replyTrendAlerts,
    };
  },
});
