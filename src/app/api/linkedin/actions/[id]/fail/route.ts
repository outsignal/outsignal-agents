import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { shouldConsumeBudgetOnFailure } from "@/lib/linkedin/action-errors";
import { markFailed, markFailedIfRunning } from "@/lib/linkedin/queue";
import { consumeBudget } from "@/lib/linkedin/rate-limiter";
import { prisma } from "@/lib/db";
import type { LinkedInActionType } from "@/lib/linkedin/types";

/**
 * POST /api/linkedin/actions/[id]/fail
 * Mark an action as failed with error details.
 * Also consumes budget so failed attempts count against the daily limit,
 * preventing runaway retries from blowing through warmup limits.
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
      if (updated && shouldConsumeBudgetOnFailure(error)) {
        await consumeBudget(action.senderId, action.actionType as LinkedInActionType);
        console.warn(
          `[fail] Budget consumed for timed-out action ${id} (sender=${action.senderId}, type=${action.actionType}, error=${error})`,
        );
      }
      return NextResponse.json({ ok: true, skipped: !updated });
    }

    const wasRunning = action.status === "running";

    const updated = await markFailed(id, error);

    // Only consume budget if the action was actually attempted (status was "running").
    // This prevents budget consumption for expired cleanup or other non-attempt transitions.
    if (wasRunning && updated && shouldConsumeBudgetOnFailure(error)) {
      await consumeBudget(action.senderId, action.actionType as LinkedInActionType);
      console.warn(
        `[fail] Budget consumed for failed action ${id} (sender=${action.senderId}, type=${action.actionType}, error=${error})`,
      );
    }

    return NextResponse.json({ ok: true, skipped: !updated });
  } catch (error) {
    console.error("Mark failed error:", error);
    return NextResponse.json({ error: "Failed to mark failed" }, { status: 500 });
  }
}
