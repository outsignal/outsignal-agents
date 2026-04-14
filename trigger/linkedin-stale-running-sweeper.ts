/**
 * Trigger.dev Scheduled Task: LinkedIn stale-running sweeper.
 *
 * Belt-and-braces safety net that runs every 15 minutes and hard-fails any
 * LinkedInAction stuck in status='running' with lastAttemptAt older than
 * the configured threshold (default 30 minutes). Complements the Railway
 * worker's built-in `recoverStuckActions()` (which runs every 60 min on
 * startup tick) by continuing to run even when the worker is offline.
 *
 * Actions flipped here are marked status='failed' with the failure reason
 * stored inside the `result` JSON blob:
 *   { error: "stuck-running-sweeper", failureReason: "stuck-running-sweeper", ... }
 *
 * The 30-minute threshold is intentionally conservative — no legitimate
 * LinkedIn action (profile view, connection request, message, withdrawal,
 * connection-accept poll) should take more than a few seconds end-to-end.
 * If a row has been "running" for half an hour it is definitively stuck.
 */

import { schedules } from "@trigger.dev/sdk";
import { sweepStuckRunningActions } from "@/lib/linkedin/queue";

const LOG_PREFIX = "[linkedin-stale-running-sweeper]";
const THRESHOLD_MINUTES = 30;

export const linkedinStaleRunningSweeperTask = schedules.task({
  id: "linkedin-stale-running-sweeper",
  cron: "*/15 * * * *", // every 15 minutes UTC
  // concurrencyLimit=1 (Finding 5.7): sweepStuckRunningActions now does a
  // per-row UPDATE, so on a workspace with thousands of stuck rows a single
  // run can take >60s. Bump maxDuration to 120s and prevent the next cron
  // tick from racing the previous one if it overruns.
  maxDuration: 120,
  queue: { concurrencyLimit: 1 },
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    console.log(`${LOG_PREFIX} sweeping status='running' with threshold=${THRESHOLD_MINUTES}min`);

    const { swept, ids } = await sweepStuckRunningActions(THRESHOLD_MINUTES);

    if (swept > 0) {
      console.warn(
        `${LOG_PREFIX} swept ${swept} stuck action(s): ${ids.slice(0, 20).join(", ")}${
          ids.length > 20 ? ` (+${ids.length - 20} more)` : ""
        }`,
      );
    } else {
      console.log(`${LOG_PREFIX} no stuck actions`);
    }

    return { swept, thresholdMinutes: THRESHOLD_MINUTES, sampleIds: ids.slice(0, 20) };
  },
});
