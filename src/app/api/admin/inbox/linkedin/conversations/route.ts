import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/admin/inbox/linkedin/conversations
 *
 * Returns LinkedIn conversations across all workspaces.
 * Optional ?workspace= filter to scope to a single workspace.
 * Includes workspaceName/workspaceSlug for admin badge display.
 */
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get("workspace");

    const where: { workspaceSlug?: string } = {};
    if (workspace) {
      where.workspaceSlug = workspace;
    }

    // Fetch conversations ordered by most recent activity
    const conversations = await prisma.linkedInConversation.findMany({
      where,
      orderBy: { lastActivityAt: "desc" },
      take: 50,
    });

    // Build workspace name map for badge display
    const workspaces = await prisma.workspace.findMany({
      select: { slug: true, name: true },
    });
    const wsMap = new Map(workspaces.map((w) => [w.slug, w.name]));

    // Two-query pattern for Person data (personId has no @relation to Person)
    const personIds = conversations
      .map((c) => c.personId)
      .filter((id): id is string => id !== null);

    const persons = await prisma.person.findMany({
      where: { id: { in: personIds } },
      select: { id: true, jobTitle: true, company: true },
    });

    const personMap = new Map(persons.map((p) => [p.id, p]));

    const result = conversations.map((conv) => {
      const person = conv.personId ? personMap.get(conv.personId) : undefined;
      return {
        id: conv.id,
        conversationId: conv.conversationId,
        participantName: conv.participantName,
        participantHeadline: conv.participantHeadline,
        participantProfilePicUrl: conv.participantProfilePicUrl,
        lastMessageSnippet: conv.lastMessageSnippet,
        lastActivityAt: conv.lastActivityAt.toISOString(),
        unreadCount: conv.unreadCount,
        jobTitle: person?.jobTitle ?? conv.participantHeadline ?? null,
        company: person?.company ?? null,
        senderId: conv.senderId,
        workspaceSlug: conv.workspaceSlug,
        workspaceName: wsMap.get(conv.workspaceSlug) ?? conv.workspaceSlug,
      };
    });

    return NextResponse.json({ conversations: result });
  } catch (err) {
    console.error("[GET /api/admin/inbox/linkedin/conversations] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 }
    );
  }
}
