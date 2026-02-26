import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { markFailed } from "@/lib/linkedin/queue";

/**
 * POST /api/linkedin/actions/[id]/fail
 * Mark an action as failed with error details.
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
    const error = body.error ?? "Unknown error";

    await markFailed(id, error);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Mark failed error:", error);
    return NextResponse.json({ error: "Failed to mark failed" }, { status: 500 });
  }
}
