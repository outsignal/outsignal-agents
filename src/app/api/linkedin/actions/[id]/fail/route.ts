import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { markFailed, markFailedIfRunning } from "@/lib/linkedin/queue";
import { prisma } from "@/lib/db";

/**
 * POST /api/linkedin/actions/[id]/fail
 * Mark an action as failed with error details.
 *
 * Failed attempts do not consume daily budget. Budget is only consumed
 * on a successful running -> complete transition.
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
    const onlyIfRunning = body.onlyIfRunning === true;

    // Fetch the action BEFORE markFailed to check its current status
    const action = await prisma.linkedInAction.findUnique({ where: { id } });
    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    if (onlyIfRunning) {
      const updated = await markFailedIfRunning(id, error);
      return NextResponse.json({ ok: true, skipped: !updated });
    }

    const updated = await markFailed(id, error);

    return NextResponse.json({ ok: true, skipped: !updated });
  } catch (error) {
    console.error("Mark failed error:", error);
    return NextResponse.json({ error: "Failed to mark failed" }, { status: 500 });
  }
}
