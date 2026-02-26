import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { markComplete } from "@/lib/linkedin/queue";
import { consumeBudget } from "@/lib/linkedin/rate-limiter";
import { prisma } from "@/lib/db";
import type { LinkedInActionType } from "@/lib/linkedin/types";

/**
 * POST /api/linkedin/actions/[id]/complete
 * Mark an action as complete and consume budget.
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

    // Get the action to know its type and sender
    const action = await prisma.linkedInAction.findUnique({ where: { id } });
    if (!action) {
      return NextResponse.json({ error: "Action not found" }, { status: 404 });
    }

    await markComplete(id, body.result ? JSON.stringify(body.result) : undefined);
    await consumeBudget(action.senderId, action.actionType as LinkedInActionType);

    // If this was a connection request, create/update the LinkedInConnection
    if (action.actionType === "connect") {
      await prisma.linkedInConnection.upsert({
        where: {
          senderId_personId: {
            senderId: action.senderId,
            personId: action.personId,
          },
        },
        create: {
          senderId: action.senderId,
          personId: action.personId,
          status: "pending",
          requestSentAt: new Date(),
        },
        update: {
          status: "pending",
          requestSentAt: new Date(),
        },
      });
    }

    // Update sender's lastActiveAt
    await prisma.sender.update({
      where: { id: action.senderId },
      data: { lastActiveAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Mark complete error:", error);
    return NextResponse.json({ error: "Failed to mark complete" }, { status: 500 });
  }
}
