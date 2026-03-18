import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { prisma } from "@/lib/db";
import { notifyLinkedInMessage } from "@/lib/notifications";

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushedMessage {
  eventUrn: string;
  senderUrn: string;
  senderName: string | null;
  body: string;
  deliveredAt: number; // epoch ms
}

interface PushedConversation {
  entityUrn: string;
  conversationId: string;
  participantName: string | null;
  participantUrn: string | null;
  participantProfileUrl: string | null;
  participantHeadline: string | null;
  participantProfilePicUrl: string | null;
  lastActivityAt: number; // epoch ms
  unreadCount: number;
  lastMessageSnippet: string | null;
  messages: PushedMessage[];
}

interface PushPayload {
  senderId: string;
  conversations: PushedConversation[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeLinkedinUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/in\/([^/?#]+)/);
  if (!match) return null;
  return `/in/${match[1].toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// POST /api/linkedin/sync/push
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PushPayload;
    const { senderId, conversations } = body;

    if (!senderId || !Array.isArray(conversations)) {
      return NextResponse.json(
        { error: "senderId and conversations[] are required" },
        { status: 400 },
      );
    }

    // Look up sender to get workspace
    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
      select: { workspaceSlug: true },
    });

    if (!sender) {
      return NextResponse.json(
        { error: "Sender not found" },
        { status: 404 },
      );
    }

    const { workspaceSlug } = sender;
    let totalNewInbound = 0;

    for (const conv of conversations) {
      const normalizedUrl = normalizeLinkedinUrl(conv.participantProfileUrl);

      // Match participant to Person by LinkedIn URL
      let personId: string | null = null;
      if (normalizedUrl) {
        const person = await prisma.person.findFirst({
          where: { linkedinUrl: { contains: normalizedUrl } },
          select: { id: true },
        });
        personId = person?.id ?? null;
      }

      // Upsert conversation
      await prisma.linkedInConversation.upsert({
        where: { conversationId: conv.conversationId },
        create: {
          conversationId: conv.conversationId,
          entityUrn: conv.entityUrn,
          senderId,
          workspaceSlug,
          personId,
          participantName: conv.participantName,
          participantUrn: conv.participantUrn,
          participantProfileUrl: normalizedUrl,
          participantHeadline: conv.participantHeadline,
          participantProfilePicUrl: conv.participantProfilePicUrl,
          lastMessageSnippet: conv.lastMessageSnippet,
          lastActivityAt: new Date(conv.lastActivityAt),
          unreadCount: conv.unreadCount,
        },
        update: {
          lastActivityAt: new Date(conv.lastActivityAt),
          unreadCount: conv.unreadCount,
          lastMessageSnippet: conv.lastMessageSnippet,
          participantName: conv.participantName,
          participantHeadline: conv.participantHeadline,
          participantProfilePicUrl: conv.participantProfilePicUrl,
        },
      });

      // Get internal conversation record for FK
      const internalConv = await prisma.linkedInConversation.findUnique({
        where: { conversationId: conv.conversationId },
        select: { id: true },
      });

      if (!internalConv) continue;

      const internalConvId = internalConv.id;
      let newInboundCount = 0;
      let latestInboundBody: string | null = null;
      let latestInboundTime = 0;

      for (const msg of conv.messages) {
        const isOutbound = msg.senderUrn !== conv.participantUrn;

        // Check if message already exists
        const existing = await prisma.linkedInMessage.findUnique({
          where: { eventUrn: msg.eventUrn },
          select: { id: true },
        });

        if (!existing) {
          await prisma.linkedInMessage.create({
            data: {
              conversationId: internalConvId,
              eventUrn: msg.eventUrn,
              senderUrn: msg.senderUrn,
              senderName: msg.senderName,
              body: msg.body,
              isOutbound,
              deliveredAt: new Date(msg.deliveredAt),
            },
          });

          if (!isOutbound) {
            newInboundCount++;
            if (msg.deliveredAt > latestInboundTime) {
              latestInboundTime = msg.deliveredAt;
              latestInboundBody = msg.body;
            }
          }
        }
      }

      // Notify for new inbound messages
      if (newInboundCount > 0 && latestInboundBody) {
        totalNewInbound += newInboundCount;
        await notifyLinkedInMessage({
          workspaceSlug,
          participantName: conv.participantName,
          participantProfileUrl: conv.participantProfileUrl,
          messageBody: latestInboundBody,
          conversationId: internalConvId,
        });
      }
    }

    // Update sync status
    await prisma.linkedInSyncStatus.upsert({
      where: { senderId },
      create: {
        senderId,
        lastSyncedAt: new Date(),
        conversationCount: conversations.length,
      },
      update: {
        lastSyncedAt: new Date(),
        conversationCount: conversations.length,
      },
    });

    return NextResponse.json({
      ok: true,
      conversationsProcessed: conversations.length,
      newInboundMessages: totalNewInbound,
    });
  } catch (error) {
    console.error("[linkedin/sync/push] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
