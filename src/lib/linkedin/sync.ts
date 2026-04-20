import { prisma } from "@/lib/db";
import { VoyagerConversation } from "@/lib/linkedin/types";
import {
  buildLinkedinProfileUrlCandidates,
  normalizeLinkedinProfileUrl,
} from "@/lib/linkedin/url";

const WORKER_URL = process.env.LINKEDIN_WORKER_URL;
const WORKER_SECRET = process.env.WORKER_API_SECRET;

/**
 * Sync LinkedIn conversations for a given sender from the Railway worker.
 * Fire-and-forget safe: wraps entire body in try/catch, never throws.
 *
 * Flow:
 * 1. Fetch conversations from worker GET /sessions/{senderId}/conversations
 * 2. Look up sender's workspaceSlug
 * 3. For each conversation, match participant to Person by LinkedIn URL
 * 4. Upsert LinkedInConversation (create or update mutable fields only)
 * 5. Update LinkedInSyncStatus with lastSyncedAt and conversationCount
 */
export async function syncLinkedInConversations(senderId: string): Promise<void> {
  try {
    if (!WORKER_URL || !WORKER_SECRET) {
      console.error("[linkedin-sync] Missing LINKEDIN_WORKER_URL or WORKER_API_SECRET");
      return;
    }

    // 1. Fetch conversations from Railway worker
    const res = await fetch(`${WORKER_URL}/sessions/${senderId}/conversations`, {
      headers: { Authorization: `Bearer ${WORKER_SECRET}` },
    });

    if (!res.ok) {
      console.error(
        `[linkedin-sync] Worker returned ${res.status} for sender ${senderId}: ${await res.text().catch(() => "(no body)")}`
      );
      return;
    }

    let conversations: VoyagerConversation[];
    try {
      const data = await res.json();
      conversations = data?.conversations;
      if (!Array.isArray(conversations) || conversations.length === 0) {
        return;
      }
    } catch (err) {
      console.error(`[linkedin-sync] Failed to parse worker response for sender ${senderId}:`, err);
      return;
    }

    // 2. Look up sender's workspaceSlug
    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
      select: { workspaceSlug: true },
    });

    if (!sender) {
      console.error(`[linkedin-sync] Sender ${senderId} not found`);
      return;
    }

    const { workspaceSlug } = sender;

    // 3. Upsert each conversation (with Person matching)
    let syncCount = 0;

    for (const conv of conversations) {
      // Match participant to Person record by LinkedIn URL
      const normalizedUrl = normalizeLinkedinProfileUrl(
        conv.participantProfileUrl,
      );

      let personId: string | null = null;
      if (normalizedUrl) {
        const exactUrlCandidates = buildLinkedinProfileUrlCandidates(
          conv.participantProfileUrl,
        );
        const person = await prisma.person.findFirst({
          where: {
            OR: exactUrlCandidates.map((candidate) => ({
              linkedinUrl: { equals: candidate, mode: "insensitive" },
            })),
          },
          select: { id: true },
        });
        if (person) {
          personId = person.id;
        }
      }

      // Upsert: create with all fields, update only mutable display fields
      // personId is NOT updated on re-sync — initial match is authoritative
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
          // participantProfileUrl NOT updated — keep normalized form from first sync
          // personId NOT updated — initial match is authoritative
        },
      });

      syncCount++;
    }

    // 4. Update sync status
    await prisma.linkedInSyncStatus.upsert({
      where: { senderId },
      create: { senderId, lastSyncedAt: new Date(), conversationCount: syncCount },
      update: { lastSyncedAt: new Date(), conversationCount: syncCount },
    });
  } catch (err) {
    console.error(`[linkedin-sync] Failed for sender ${senderId}:`, err);
  }
}
