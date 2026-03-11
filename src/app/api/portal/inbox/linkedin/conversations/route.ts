import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

/**
 * GET /api/portal/inbox/linkedin/conversations
 *
 * Returns workspace-scoped LinkedIn conversations ordered by most recent activity.
 * Uses a two-query pattern to join Person jobTitle/company (no @relation on personId).
 */
export async function GET() {
  // 1. Auth via portal session
  let workspaceSlug: string;
  try {
    const session = await getPortalSession();
    workspaceSlug = session.workspaceSlug;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Fetch workspace conversations ordered by most recent activity
  const conversations = await prisma.linkedInConversation.findMany({
    where: { workspaceSlug },
    orderBy: { lastActivityAt: "desc" },
    take: 50,
  });

  // 3. Two-query pattern for Person data (personId has no @relation to Person)
  const personIds = conversations
    .map((c) => c.personId)
    .filter((id): id is string => id !== null);

  const persons = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, jobTitle: true, company: true },
  });

  const personMap = new Map(persons.map((p) => [p.id, p]));

  // 4. Map conversations to response shape with Person subtitle data
  const result = conversations.map((conv) => {
    const person = conv.personId ? personMap.get(conv.personId) : undefined;
    return {
      id: conv.id, // internal cuid — used as URL param in UI
      conversationId: conv.conversationId, // LinkedIn's ID — used for worker calls
      participantName: conv.participantName,
      participantHeadline: conv.participantHeadline,
      participantProfilePicUrl: conv.participantProfilePicUrl,
      lastMessageSnippet: conv.lastMessageSnippet,
      lastActivityAt: conv.lastActivityAt.toISOString(),
      unreadCount: conv.unreadCount,
      jobTitle: person?.jobTitle ?? conv.participantHeadline ?? null, // fallback to headline
      company: person?.company ?? null,
      senderId: conv.senderId,
    };
  });

  // 5. Return conversation list
  return NextResponse.json({ conversations: result });
}
