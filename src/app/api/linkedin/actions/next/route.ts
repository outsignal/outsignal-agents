import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { getNextBatch, markRunning } from "@/lib/linkedin/queue";
import { prisma } from "@/lib/db";

/**
 * GET /api/linkedin/actions/next?senderId=X&limit=10
 * Returns the next batch of ready actions for a sender.
 * Marks them as "running" so they won't be picked up by another worker.
 * Includes the person's linkedinUrl so the worker knows where to navigate.
 */
export async function GET(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const senderId = request.nextUrl.searchParams.get("senderId");
    const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "10", 10);

    if (!senderId) {
      return NextResponse.json({ error: "senderId is required" }, { status: 400 });
    }

    const actions = await getNextBatch(senderId, limit);

    // Mark each as running and resolve LinkedIn URLs
    const enrichedActions = [];
    for (const action of actions) {
      await markRunning(action.id);

      // Resolve person's LinkedIn URL
      const person = await prisma.person.findUnique({
        where: { id: action.personId },
        select: { linkedinUrl: true },
      });

      enrichedActions.push({
        ...action,
        linkedinUrl: person?.linkedinUrl ?? null,
      });
    }

    return NextResponse.json({ actions: enrichedActions });
  } catch (error) {
    console.error("Get next batch error:", error);
    return NextResponse.json({ error: "Failed to get next batch" }, { status: 500 });
  }
}
