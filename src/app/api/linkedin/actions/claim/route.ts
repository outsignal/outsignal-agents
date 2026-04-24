import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { claimSpecificActions } from "@/lib/linkedin/queue";
import { prisma } from "@/lib/db";

/**
 * POST /api/linkedin/actions/claim
 * Claims a worker-selected ordered subset of pending LinkedIn actions.
 */
export async function POST(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const senderId =
      typeof body?.senderId === "string" ? body.senderId : null;
    const actionIds = Array.isArray(body?.actionIds)
      ? body.actionIds.filter((value: unknown): value is string => typeof value === "string")
      : [];

    if (!senderId) {
      return NextResponse.json({ error: "senderId is required" }, { status: 400 });
    }

    await prisma.sender.update({
      where: { id: senderId },
      data: { lastPolledAt: new Date() },
    });

    const actions = await claimSpecificActions(senderId, actionIds);

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
    console.error("Claim actions error:", error);
    return NextResponse.json(
      { error: "Failed to claim actions" },
      { status: 500 },
    );
  }
}
