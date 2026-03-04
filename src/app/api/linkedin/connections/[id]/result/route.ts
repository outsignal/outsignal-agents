import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { processConnectionCheckResult } from "@/lib/linkedin/connection-poller";

/**
 * POST /api/linkedin/connections/[id]/result
 * Report the result of a VoyagerClient connection status check.
 *
 * Body: { "status": "connected" | "pending" | "not_connected" }
 *
 * When status is "connected", processConnectionCheckResult triggers
 * evaluateSequenceRules() for follow-up messages.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const status = body.status as string | undefined;

    if (!status || !["connected", "pending", "not_connected"].includes(status)) {
      return NextResponse.json(
        { error: "status must be one of: connected, pending, not_connected" },
        { status: 400 },
      );
    }

    // Map worker status values to processConnectionCheckResult values
    const mappedStatus: "connected" | "none" | "failed" =
      status === "connected"
        ? "connected"
        : status === "not_connected"
          ? "failed"
          : "none";

    await processConnectionCheckResult(id, mappedStatus);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[connections/result] Error:`, error);
    return NextResponse.json(
      { error: "Failed to process connection result" },
      { status: 500 },
    );
  }
}
