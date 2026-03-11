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
