import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import {
  getConnectionsToCheck,
  pollConnectionAccepts,
} from "@/lib/linkedin/connection-poller";

/**
 * GET /api/linkedin/connections/check?workspace=rise
 * Returns pending connections that need a live status check via VoyagerClient.
 * Also runs timeout/retry logic (pollConnectionAccepts) before returning.
 */
export async function GET(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspaceSlug = request.nextUrl.searchParams.get("workspace");
    if (!workspaceSlug) {
      return NextResponse.json(
        { error: "workspace query param is required" },
        { status: 400 },
      );
    }

    // Run timeout/retry logic first
    const pollResult = await pollConnectionAccepts(workspaceSlug);
    console.log(
      `[connections/check] pollConnectionAccepts for ${workspaceSlug}: ` +
        `checked=${pollResult.checked} timedOut=${pollResult.timedOut} failed=${pollResult.failed}`,
    );

    // Return connections that need a live API status check
    const connections = await getConnectionsToCheck(workspaceSlug);

    return NextResponse.json({ connections });
  } catch (error) {
    console.error("[connections/check] Error:", error);
    return NextResponse.json(
      { error: "Failed to get connections to check" },
      { status: 500 },
    );
  }
}
