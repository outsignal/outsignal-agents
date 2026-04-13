import { syncSendersForAllWorkspaces } from "@/lib/emailbison/sync-senders";

/**
 * Sync senders for all workspaces.
 * Called from inbox-check task at the end of its daily run.
 */
export async function runSyncSenders() {
  console.log("[sync-senders] Starting daily sender sync");

  const result = await syncSendersForAllWorkspaces();

  console.log(
    `[sync-senders] Complete: ${result.workspaces} workspaces, ${result.synced} synced, ${result.created} created, ${result.deactivated} deactivated, ${result.skipped} skipped, ${result.errors.length} errors`,
  );

  if (result.errors.length > 0) {
    console.warn("[sync-senders] Errors during sync:", result.errors);
  }

  return result;
}
