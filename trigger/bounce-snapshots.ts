import { schedules } from "@trigger.dev/sdk";
import { captureAllWorkspaces } from "@/lib/domain-health/snapshots";

export const bounceSnapshotsTask = schedules.task({
  id: "bounce-snapshots",
  cron: "0 8 * * *", // daily 8am UTC
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    console.log("[bounce-snapshots] Starting daily bounce snapshot capture");

    const result = await captureAllWorkspaces();

    console.log(
      `[bounce-snapshots] Complete: ${result.workspaces} workspaces, ${result.senders} senders captured, ${result.errors.length} errors`,
    );

    if (result.errors.length > 0) {
      console.warn("[bounce-snapshots] Errors during capture:", result.errors);
    }

    return result;
  },
});
