import { NextRequest, NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import {
  buildLinkedInMessageLookup,
  findLinkedInMessageMatch,
  getLinkedInMessageUpdatePatch,
  mergeLinkedInMessageSnapshot,
  rememberLinkedInMessage,
  resolveLinkedInMessageDirection,
} from "@/lib/linkedin/messages";
import { extractLinkedInMessageId } from "@/lib/linkedin/urn";
import type { VoyagerMessage } from "@/lib/linkedin/types";

/**
 * GET /api/portal/inbox/linkedin/conversations/[conversationId]/messages
 *
 * The conversationId URL param is the internal cuid (LinkedInConversation.id),
 * NOT LinkedIn's conversation ID.
 *
 * On first access (no DB messages), fetches from the Railway worker,
 * upserts into LinkedInMessage, then returns chronologically ordered messages.
 * Add ?refresh=true to force a fresh fetch from the worker even if DB has messages.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  // 1. Auth via portal session
  let workspaceSlug: string;
  try {
    const session = await getPortalSession();
    workspaceSlug = session.workspaceSlug;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;
  const refresh = request.nextUrl.searchParams.get("refresh") === "true";

  // 2. Resolve conversation (scoped to workspace)
  const conv = await prisma.linkedInConversation.findFirst({
    where: { id: conversationId, workspaceSlug },
  });

  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // 3. Check for existing messages in DB
  const dbMessages = await prisma.linkedInMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { deliveredAt: "asc" },
  });

  // 4. Return DB messages immediately if they exist and no refresh requested
  if (dbMessages.length > 0 && !refresh) {
    return NextResponse.json({
      messages: dbMessages,
      conversationId: conv.id,
      participantName: conv.participantName,
      participantUrn: conv.participantUrn,
      senderId: conv.senderId,
    });
  }

  // 5. Fetch from Railway worker (no DB messages or refresh=true)
  const WORKER_URL = process.env.LINKEDIN_WORKER_URL;
  const WORKER_SECRET = process.env.WORKER_API_SECRET;

  if (!WORKER_URL || !WORKER_SECRET) {
    console.error("[linkedin-messages] Missing LINKEDIN_WORKER_URL or WORKER_API_SECRET env vars");
    // Graceful degradation: return what we have in DB
    return NextResponse.json({
      messages: dbMessages,
      conversationId: conv.id,
      participantName: conv.participantName,
      participantUrn: conv.participantUrn,
      senderId: conv.senderId,
    });
  }

  let messages = dbMessages;
  const messageLookup = buildLinkedInMessageLookup(dbMessages);

  try {
    const workerRes = await fetch(
      `${WORKER_URL}/sessions/${conv.senderId}/conversations/${conv.conversationId}/messages`,
      {
        headers: { Authorization: `Bearer ${WORKER_SECRET}` },
      }
    );

    if (!workerRes.ok) {
      console.error(
        `[linkedin-messages] Worker returned ${workerRes.status} for conversation ${conv.conversationId}`
      );
      // Graceful degradation: return existing DB messages
    } else {
      const raw = await workerRes.json();

      // Defensive parse — worker may use messages or data envelope
      const workerMessages: VoyagerMessage[] = raw?.messages ?? raw?.data ?? [];

      if (!Array.isArray(workerMessages) || (!raw?.messages && !raw?.data)) {
        console.warn(
          "[linkedin-messages] Unknown response envelope:",
          Object.keys(raw ?? {})
        );
      }

      // Upsert each worker message into DB
      for (const msg of workerMessages) {
        const direction = resolveLinkedInMessageDirection(
          msg.senderUrn,
          conv.participantUrn,
        );
        if (!direction.confident) {
          console.warn(
            `[linkedin-messages] Unable to confidently classify direction for ${msg.eventUrn}; defaulting inbound`,
            {
              senderUrn: msg.senderUrn,
              participantUrn: conv.participantUrn,
            },
          );
        }

        const existing = findLinkedInMessageMatch(messageLookup, msg.eventUrn);
        if (!existing.entry) {
          if (!extractLinkedInMessageId(msg.eventUrn)) {
            console.error(
              `[linkedin-messages] Missing canonical message ID for live dedupe on ${msg.eventUrn}; storing by raw eventUrn`,
            );
          }

          const created = await prisma.linkedInMessage.create({
            data: {
              conversationId: conv.id, // internal cuid FK
              eventUrn: msg.eventUrn,
              senderUrn: msg.senderUrn,
              senderName: msg.senderName,
              body: msg.body,
              isOutbound: direction.isOutbound,
              deliveredAt: new Date(msg.deliveredAt),
            },
          });
          rememberLinkedInMessage(messageLookup, created);
          continue;
        }

        const patch = getLinkedInMessageUpdatePatch(existing.entry, {
          eventUrn: msg.eventUrn,
          senderUrn: msg.senderUrn,
          senderName: msg.senderName,
          body: msg.body,
          isOutbound: direction.isOutbound,
        });

        if (patch) {
          await prisma.linkedInMessage.update({
            where: { id: existing.entry.id },
            data: patch,
          });
          rememberLinkedInMessage(
            messageLookup,
            mergeLinkedInMessageSnapshot(existing.entry, patch),
          );
        }
      }

      // Re-query DB for consistent ordering after upsert
      messages = await prisma.linkedInMessage.findMany({
        where: { conversationId: conv.id },
        orderBy: { deliveredAt: "asc" },
      });
    }
  } catch (err) {
    console.error("[linkedin-messages] Worker fetch failed:", err);
    // Graceful degradation: return existing DB messages
  }

  return NextResponse.json({
    messages,
    conversationId: conv.id,
    participantName: conv.participantName,
    participantUrn: conv.participantUrn,
    senderId: conv.senderId,
  });
}
