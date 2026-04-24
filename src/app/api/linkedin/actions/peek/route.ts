import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { getNextBatch } from "@/lib/linkedin/queue";
import { prisma } from "@/lib/db";

/**
 * GET /api/linkedin/actions/peek?senderId=X&limit=5
 * Returns the next read-only candidate window for a sender without claiming it.
 * The worker uses this to estimate which actions can fit the current sender tick
 * before compare-and-swap claiming the exact IDs it wants to execute.
 */
export async function GET(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const senderId = request.nextUrl.searchParams.get("senderId");
    const perTypeLimit = parseInt(
      request.nextUrl.searchParams.get("limit") ?? "5",
      10,
    );

    if (!senderId) {
      return NextResponse.json({ error: "senderId is required" }, { status: 400 });
    }

    const actions = await getNextBatch(senderId, perTypeLimit);

    if (actions.length === 0) {
      return NextResponse.json({ actions: [] });
    }

    const personIds = [...new Set(actions.map((a) => a.personId).filter(Boolean))] as string[];
    const conversationIds = [
      ...new Set(actions.map((a) => a.linkedInConversationId).filter(Boolean)),
    ] as string[];

    const people = personIds.length > 0
      ? await prisma.person.findMany({
          where: { id: { in: personIds } },
          select: { id: true, linkedinUrl: true },
        })
      : [];
    const personUrlMap = new Map(people.map((p) => [p.id, p.linkedinUrl]));

    const conversations = conversationIds.length > 0
      ? await prisma.linkedInConversation.findMany({
          where: { id: { in: conversationIds } },
          select: { id: true, participantProfileUrl: true },
        })
      : [];
    const convUrlMap = new Map(conversations.map((c) => [c.id, c.participantProfileUrl]));

    const enrichedActions = actions.map((action) => ({
      ...action,
      linkedinUrl:
        (action.personId ? personUrlMap.get(action.personId) : null)
        ?? (action.linkedInConversationId
          ? convUrlMap.get(action.linkedInConversationId)
          : null)
        ?? null,
    }));

    return NextResponse.json({ actions: enrichedActions });
  } catch (error) {
    console.error("Peek next batch error:", error);
    return NextResponse.json(
      { error: "Failed to peek next batch" },
      { status: 500 },
    );
  }
}
