import { schedules } from "@trigger.dev/sdk";
import { syncSendersForAllWorkspaces } from "@/lib/emailbison/sync-senders";

export const syncSendersTask = schedules.task({
  id: "sync-senders",
  cron: "0 5 * * *", // daily 5am UTC
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    console.log("[sync-senders] Starting daily sender sync");

    const result = await syncSendersForAllWorkspaces();

    console.log(
      `[sync-senders] Complete: ${result.workspaces} workspaces, ${result.synced} synced, ${result.created} created, ${result.skipped} skipped, ${result.errors.length} errors`,
    );

    if (result.errors.length > 0) {
      console.warn("[sync-senders] Errors during sync:", result.errors);
    }

    return result;
  },
});
