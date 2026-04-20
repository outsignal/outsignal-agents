import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { claimNextBatch } from "@/lib/linkedin/queue";
import { prisma } from "@/lib/db";

/**
 * GET /api/linkedin/actions/next?senderId=X&limit=5
 * Returns the next batch of ready actions for a sender.
 * The limit parameter is PER ACTION TYPE (connections, views, messages each get up to limit).
 * Marks them as "running" so they won't be picked up by another worker.
 * Includes the person's linkedinUrl so the worker knows where to navigate.
 */
export async function GET(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const senderId = request.nextUrl.searchParams.get("senderId");
    const perTypeLimit = parseInt(request.nextUrl.searchParams.get("limit") ?? "5", 10);

    if (!senderId) {
      return NextResponse.json({ error: "senderId is required" }, { status: 400 });
    }

    // Update heartbeat timestamp — tracks worker polling
    await prisma.sender.update({
      where: { id: senderId },
      data: { lastPolledAt: new Date() },
    });

    const actions = await claimNextBatch(senderId, perTypeLimit);

    if (actions.length === 0) {
      // Check if there are pending actions — if so, budget or circuit breaker is blocking
      const pendingCount = await prisma.linkedInAction.count({
        where: {
          senderId,
          status: "pending",
          scheduledFor: { lte: new Date() },
        },
      });

      if (pendingCount > 0) {
        console.warn(
          `[next] No actions returned for sender ${senderId} despite ${pendingCount} pending — budget exhausted or circuit breaker active`,
        );
      }

      return NextResponse.json({ actions: [] });
    }

    const personIds = [...new Set(actions.map((a) => a.personId).filter(Boolean))] as string[];
    const conversationIds = [
      ...new Set(actions.map((a) => a.linkedInConversationId).filter(Boolean)),
    ] as string[];

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
