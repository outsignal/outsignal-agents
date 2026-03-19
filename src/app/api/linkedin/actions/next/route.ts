import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { getNextBatch } from "@/lib/linkedin/queue";
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

    // Update heartbeat timestamp — tracks worker polling
    await prisma.sender.update({
      where: { id: senderId },
      data: { lastPolledAt: new Date() },
    });

    const actions = await getNextBatch(senderId, limit);

    if (actions.length === 0) {
      return NextResponse.json({ actions: [] });
    }

    const actionIds = actions.map((a) => a.id);
    const personIds = [...new Set(actions.map((a) => a.personId).filter(Boolean))] as string[];
    const conversationIds = [
      ...new Set(actions.map((a) => a.linkedInConversationId).filter(Boolean)),
    ] as string[];

    // Batch mark all actions as running (single UPDATE instead of N)
    await prisma.linkedInAction.updateMany({
      where: { id: { in: actionIds } },
      data: {
        status: "running",
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    // Batch fetch all person LinkedIn URLs (single SELECT instead of N)
    const people = personIds.length > 0
      ? await prisma.person.findMany({
          where: { id: { in: personIds } },
          select: { id: true, linkedinUrl: true },
        })
      : [];
    const personUrlMap = new Map(people.map((p) => [p.id, p.linkedinUrl]));

    // Batch fetch conversation participant URLs for actions without personId
    const conversations = conversationIds.length > 0
      ? await prisma.linkedInConversation.findMany({
          where: { id: { in: conversationIds } },
          select: { id: true, participantProfileUrl: true },
        })
      : [];
    const convUrlMap = new Map(conversations.map((c) => [c.id, c.participantProfileUrl]));

    // Build enriched response from in-memory join
    // Prefer person linkedinUrl; fall back to conversation participantProfileUrl
    const enrichedActions = actions.map((action) => ({
      ...action,
      linkedinUrl:
        (action.personId ? personUrlMap.get(action.personId) : null)
        ?? (action.linkedInConversationId ? convUrlMap.get(action.linkedInConversationId) : null)
        ?? null,
    }));

    return NextResponse.json({ actions: enrichedActions });
  } catch (error) {
    console.error("Get next batch error:", error);
    return NextResponse.json({ error: "Failed to get next batch" }, { status: 500 });
  }
}
