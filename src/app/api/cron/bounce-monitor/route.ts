/**
 * Bounce Monitor Cron Endpoint
 *
 * Runs every 4 hours via cron-job.org — evaluates all active sender email addresses
 * against bounce rate thresholds and fires Slack + email notifications for any
 * sender status transitions. No notifications for sustained states (transition-only).
 *
 * Register on cron-job.org:
 *   Schedule: every 4 hours (0:00, 4:00, 8:00, 12:00, 16:00, 20:00 UTC)
 *   URL: https://admin.outsignal.ai/api/cron/bounce-monitor
 *   Header: Authorization: Bearer {CRON_SECRET}
 */

import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { runBounceMonitor, replaceSender } from "@/lib/domain-health/bounce-monitor";
import { notifySenderHealthTransition } from "@/lib/domain-health/bounce-notifications";
import { prisma } from "@/lib/db";

export const maxDuration = 60;

const LOG_PREFIX = "[cron/bounce-monitor]";

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    console.log(`[${new Date().toISOString()}] Unauthorized: GET /api/cron/bounce-monitor`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timestamp = new Date().toISOString();
  console.log(`${LOG_PREFIX} Starting bounce monitor run at ${timestamp}`);

  try {
    // 1. Run the state machine across all active senders
    const result = await runBounceMonitor();

    // 2. Send notifications for each transition (gated here — no repeats for sustained states)
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

        await notifySenderHealthTransition({
          senderEmail: transition.senderEmail,
          workspaceSlug: transition.workspaceSlug,
          fromStatus: transition.from,
          toStatus: transition.to,
          reason: transition.reason,
          action: transition.action,
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
            // Insight failure must not break the cron
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

    console.log(
      `${LOG_PREFIX} Evaluated ${result.evaluated}, transitioned ${result.transitioned}, skipped ${result.skipped}`,
    );

    return NextResponse.json({
      status: "ok",
      evaluated: result.evaluated,
      transitioned: result.transitioned,
      skipped: result.skipped,
      transitions: result.transitions,
      timestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    return NextResponse.json(
      { error: "Internal error", message, timestamp },
      { status: 500 },
    );
  }
}
