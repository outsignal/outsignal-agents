/**
 * Trigger.dev Scheduled Task: Post-Launch Campaign Verification
 *
 * Runs every 2 hours to verify that recently deployed campaigns
 * are actually sending. Flags campaigns that have been active 12+
 * hours with zero sends/connections and alerts via Slack + DB notification.
 */

import { schedules } from "@trigger.dev/sdk";
import { runPostLaunchCheckWithNotifications } from "@/lib/monitoring/post-launch-check";

const LOG_PREFIX = "[post-launch-check]";

export const postLaunchCheckTask = schedules.task({
  id: "post-launch-check",
  cron: "0 */2 * * *", // every 2 hours UTC
  maxDuration: 120, // 2 min — mostly DB reads + a few EB API calls
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    console.log(`${LOG_PREFIX} Starting post-launch verification`);

    const result = await runPostLaunchCheckWithNotifications();

    console.log(
      `${LOG_PREFIX} Done: ${result.campaignsChecked} campaigns checked, ${result.flagged.length} flagged, ${result.errors.length} errors`,
    );

    return result;
  },
});
