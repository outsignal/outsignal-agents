import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";
import type { VoyagerMessage } from "@/lib/linkedin/types";

/**
 * GET /api/admin/inbox/linkedin/conversations/[id]/messages
 *
 * Admin version: no workspace scope restriction.
 * The id param is the internal cuid (LinkedInConversation.id).
 * Fetches from DB first; falls back to Railway worker if no messages exist.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const refresh = request.nextUrl.searchParams.get("refresh") === "true";

    // Resolve conversation — no workspace scope for admin
    const conv = await prisma.linkedInConversation.findFirst({
      where: { id },
    });

    if (!conv) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Check for existing messages in DB
    const dbMessages = await prisma.linkedInMessage.findMany({
      where: { conversationId: conv.id },
      orderBy: { deliveredAt: "asc" },
    });

    // Return DB messages immediately if they exist and no refresh requested
    if (dbMessages.length > 0 && !refresh) {
      // Cross-channel: check if this person also has an email thread
      let crossChannel: { type: "email"; threadId: number } | null = null;
      if (conv.personId) {
        const emailReply = await prisma.reply.findFirst({
          where: { workspaceSlug: conv.workspaceSlug, personId: conv.personId, direction: "inbound" },
          select: { emailBisonParentId: true, emailBisonReplyId: true },
          orderBy: { receivedAt: "desc" },
        });
        const threadId = emailReply?.emailBisonParentId ?? emailReply?.emailBisonReplyId;
        if (threadId) {
          crossChannel = { type: "email", threadId };
        }
      }

      return NextResponse.json({
        messages: dbMessages,
        conversationId: conv.id,
        participantName: conv.participantName,
        participantUrn: conv.participantUrn,
        senderId: conv.senderId,
        crossChannel,
      });
    }

    // Fetch from Railway worker if no DB messages or refresh=true
    const WORKER_URL = process.env.LINKEDIN_WORKER_URL;
    const WORKER_SECRET = process.env.WORKER_API_SECRET;

    let messages = dbMessages;

    if (WORKER_URL && WORKER_SECRET) {
      try {
        const workerRes = await fetch(
          `${WORKER_URL}/sessions/${conv.senderId}/conversations/${conv.conversationId}/messages`,
          {
            headers: { Authorization: `Bearer ${WORKER_SECRET}` },
          }
        );

        if (workerRes.ok) {
          const raw = await workerRes.json();
          const workerMessages: VoyagerMessage[] = raw?.messages ?? raw?.data ?? [];

          for (const msg of workerMessages) {
            await prisma.linkedInMessage.upsert({
              where: { eventUrn: msg.eventUrn },
              create: {
                conversationId: conv.id,
                eventUrn: msg.eventUrn,
                senderUrn: msg.senderUrn,
                senderName: msg.senderName,
                body: msg.body,
                isOutbound: msg.senderUrn !== conv.participantUrn,
                deliveredAt: new Date(msg.deliveredAt),
              },
              update: {},
            });
          }

          messages = await prisma.linkedInMessage.findMany({
            where: { conversationId: conv.id },
            orderBy: { deliveredAt: "asc" },
          });
        }
      } catch (err) {
        console.error("[admin linkedin-messages] Worker fetch failed:", err);
      }
    }

    // Cross-channel lookup
    let crossChannel: { type: "email"; threadId: number } | null = null;
    if (conv.personId) {
      const emailReply = await prisma.reply.findFirst({
        where: { workspaceSlug: conv.workspaceSlug, personId: conv.personId, direction: "inbound" },
        select: { emailBisonParentId: true, emailBisonReplyId: true },
        orderBy: { receivedAt: "desc" },
      });
      const threadId = emailReply?.emailBisonParentId ?? emailReply?.emailBisonReplyId;
      if (threadId) {
        crossChannel = { type: "email", threadId };
      }
    }

    return NextResponse.json({
      messages,
      conversationId: conv.id,
      participantName: conv.participantName,
      participantUrn: conv.participantUrn,
      senderId: conv.senderId,
      crossChannel,
    });
  } catch (err) {
    console.error("[GET /api/admin/inbox/linkedin/conversations/[id]/messages] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}
