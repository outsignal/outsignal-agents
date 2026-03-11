import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { syncSendersForAllWorkspaces } from "@/lib/emailbison/sync-senders";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    console.log(
      `[${new Date().toISOString()}] Unauthorized: GET /api/cron/sync-senders`,
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timestamp = new Date().toISOString();
  console.log(`[sync-senders] Starting daily sender sync at ${timestamp}`);

  try {
    const result = await syncSendersForAllWorkspaces();

    console.log(
      `[sync-senders] Complete: ${result.workspaces} workspaces, ${result.synced} synced, ${result.created} created, ${result.skipped} skipped, ${result.errors.length} errors`,
    );

    if (result.errors.length > 0) {
      console.warn("[sync-senders] Errors during sync:", result.errors);
    }

    return NextResponse.json({
      status: "ok",
      workspaces: result.workspaces,
      synced: result.synced,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
      timestamp,
    });
  } catch (error) {
    console.error("[sync-senders] Fatal error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Sender sync failed",
        timestamp,
      },
      { status: 500 },
    );
  }
}
