import { PrismaClient } from "@prisma/client";
import type { VoyagerMessage } from "@/lib/linkedin/types";

const WORKER_URL = process.env.LINKEDIN_WORKER_URL;
const WORKER_SECRET = process.env.WORKER_API_SECRET;

/**
 * Sync messages for a single LinkedIn conversation from the Railway worker.
 * Returns the count of NEW messages that were created (not updated).
 * Only counts inbound messages in the new count (for notification purposes).
 */
export async function syncLinkedInMessages(
  prisma: PrismaClient,
  conversation: {
    id: string; // internal cuid
    conversationId: string; // LinkedIn's conversation ID
    senderId: string;
    participantUrn: string | null;
  }
): Promise<{ total: number; newInbound: number }> {
  if (!WORKER_URL || !WORKER_SECRET) {
    console.error("[linkedin-msg-sync] Missing LINKEDIN_WORKER_URL or WORKER_API_SECRET");
    return { total: 0, newInbound: 0 };
  }

  try {
    const res = await fetch(
      `${WORKER_URL}/sessions/${conversation.senderId}/conversations/${conversation.conversationId}/messages`,
      { headers: { Authorization: `Bearer ${WORKER_SECRET}` } }
    );

    if (!res.ok) {
      console.error(
        `[linkedin-msg-sync] Worker returned ${res.status} for conversation ${conversation.conversationId}`
      );
      return { total: 0, newInbound: 0 };
    }

    const raw = await res.json();
    const workerMessages: VoyagerMessage[] = raw?.messages ?? raw?.data ?? [];

    if (!Array.isArray(workerMessages) || workerMessages.length === 0) {
      return { total: 0, newInbound: 0 };
    }

    let newInbound = 0;

    for (const msg of workerMessages) {
      const isOutbound = msg.senderUrn !== conversation.participantUrn;

      // Check if message already exists
      const existing = await prisma.linkedInMessage.findUnique({
        where: { eventUrn: msg.eventUrn },
        select: { id: true },
      });

      if (!existing) {
        await prisma.linkedInMessage.create({
          data: {
            conversationId: conversation.id, // internal cuid FK
            eventUrn: msg.eventUrn,
            senderUrn: msg.senderUrn,
            senderName: msg.senderName,
            body: msg.body,
            isOutbound,
            deliveredAt: new Date(msg.deliveredAt),
          },
        });

        if (!isOutbound) {
          newInbound++;
        }
      }
    }

    return { total: workerMessages.length, newInbound };
  } catch (err) {
    console.error(
      `[linkedin-msg-sync] Failed for conversation ${conversation.conversationId}:`,
      err
    );
    return { total: 0, newInbound: 0 };
  }
}
