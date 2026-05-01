import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
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
import { notifyLinkedInMessage } from "@/lib/notifications";
import { cancelActionsForPerson } from "@/lib/linkedin/queue";
import {
  buildLinkedinProfileUrlCandidates,
  normalizeLinkedinProfileUrl,
} from "@/lib/linkedin/url";

export const maxDuration = 30;

const FRESHNESS_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

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
      const normalizedUrl = normalizeLinkedinProfileUrl(
        conv.participantProfileUrl,
      );

      // Match participant to Person — try LinkedIn URL first, then name via LinkedInAction
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
        personId = person?.id ?? null;
      }
      // Fallback: match by participant name against Person records in this workspace
      if (!personId && conv.participantName) {
        const nameParts = conv.participantName.trim().split(/\s+/);
        const firstName = nameParts[0] ?? null;
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;
        if (firstName && lastName) {
          const person = await prisma.person.findFirst({
            where: {
              firstName: { equals: firstName, mode: "insensitive" },
              lastName: { equals: lastName, mode: "insensitive" },
              workspaces: {
                some: {
                  workspace: workspaceSlug,
                },
              },
            },
            select: { id: true },
          });
          personId = person?.id ?? null;
        }
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
          // Don't overwrite unreadCount — portal controls read state locally
          lastMessageSnippet: conv.lastMessageSnippet,
          participantName: conv.participantName,
          participantHeadline: conv.participantHeadline,
          participantProfilePicUrl: conv.participantProfilePicUrl,
          participantProfileUrl: normalizedUrl,
          // Re-match personId on update so late Person records get linked
          ...(personId ? { personId } : {}),
        },
      });

      // Get internal conversation record for FK
      const internalConv = await prisma.linkedInConversation.findUnique({
        where: { conversationId: conv.conversationId },
        select: { id: true, personId: true },
      });

      if (!internalConv) continue;

      const internalConvId = internalConv.id;
      let newInboundCount = 0;
      let latestInboundBody: string | null = null;
      let latestInboundTime = 0;
      const existingMessages = await prisma.linkedInMessage.findMany({
        where: { conversationId: internalConvId },
        select: {
          id: true,
          eventUrn: true,
          senderUrn: true,
          senderName: true,
          body: true,
          isOutbound: true,
          deliveredAt: true,
        },
      });
      const messageLookup = buildLinkedInMessageLookup(existingMessages);

      for (const msg of conv.messages) {
        const direction = resolveLinkedInMessageDirection(
          msg.senderUrn,
          conv.participantUrn,
        );
        if (!direction.confident) {
          console.warn(
            `[linkedin/sync/push] Unable to confidently classify direction for ${msg.eventUrn}; defaulting inbound`,
            {
              senderUrn: msg.senderUrn,
              participantUrn: conv.participantUrn,
            },
          );
        }

        const isOutbound = direction.isOutbound;
        const existing = findLinkedInMessageMatch(messageLookup, msg.eventUrn);

        if (existing.entry) {
          // Update body if worker now extracts more content (e.g. URLs from attachments)
          const patch = getLinkedInMessageUpdatePatch(existing.entry, {
            eventUrn: msg.eventUrn,
            senderUrn: msg.senderUrn,
            senderName: msg.senderName,
            body: msg.body,
            isOutbound,
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
          continue;
        }

        if (!extractLinkedInMessageId(msg.eventUrn)) {
          console.error(
            `[linkedin/sync/push] Missing canonical message ID for live dedupe on ${msg.eventUrn}; storing by raw eventUrn`,
          );
        }

        const deliveredAt = new Date(msg.deliveredAt);
        const created = await prisma.linkedInMessage.create({
          data: {
            conversationId: internalConvId,
            eventUrn: msg.eventUrn,
            senderUrn: msg.senderUrn,
            senderName: msg.senderName,
            body: msg.body,
            isOutbound,
            deliveredAt,
          },
        });
        rememberLinkedInMessage(messageLookup, created);

        if (!isOutbound) {
          const ageMs = Date.now() - deliveredAt.getTime();
          if (ageMs > FRESHNESS_THRESHOLD_MS) {
            const ageMinutes = Math.round(ageMs / (60 * 1000));
            console.log(
              `[sync/push] Skipped notification for stale inbound message ${created.id} (age: ${ageMinutes}min)`,
            );
            continue;
          }

          newInboundCount++;
          if (msg.deliveredAt > latestInboundTime) {
            latestInboundTime = msg.deliveredAt;
            latestInboundBody = msg.body;
          }
        }
      }

      // Attach outbound messages from completed actions that aren't in embedded messages
      try {
        const resolvedPid = internalConv.personId ?? personId;
        if (resolvedPid) {
          const completedOutboundActions = await prisma.linkedInAction.findMany({
            where: {
              senderId,
              personId: resolvedPid,
              actionType: "message",
              status: "complete",
              messageBody: { not: null },
            },
            select: { id: true, messageBody: true, completedAt: true },
          });

          for (const act of completedOutboundActions) {
            const syntheticUrn = `urn:outsignal:outbound:${act.id}`;
            const existing = findLinkedInMessageMatch(messageLookup, syntheticUrn);
            if (existing.entry) continue;

            const bodyMatch = await prisma.linkedInMessage.findFirst({
              where: {
                conversationId: internalConvId,
                body: act.messageBody!,
                isOutbound: true,
              },
              select: { id: true },
            });
            if (bodyMatch) continue;

            const created = await prisma.linkedInMessage.create({
              data: {
                conversationId: internalConvId,
                eventUrn: syntheticUrn,
                senderUrn: "",
                senderName: null,
                body: act.messageBody!,
                isOutbound: true,
                deliveredAt: act.completedAt ?? new Date(),
              },
            });
            rememberLinkedInMessage(messageLookup, created);
          }
        }

        // Also check by linkedInConversationId (for replies where personId was null)
        const actionsViaConvId = await prisma.linkedInAction.findMany({
          where: {
            senderId,
            linkedInConversationId: internalConvId,
            actionType: "message",
            status: "complete",
            messageBody: { not: null },
          },
          select: { id: true, messageBody: true, completedAt: true },
        });

        for (const act of actionsViaConvId) {
          const syntheticUrn = `urn:outsignal:outbound:${act.id}`;
          const existing = findLinkedInMessageMatch(messageLookup, syntheticUrn);
          if (existing.entry) continue;

          const bodyMatch = await prisma.linkedInMessage.findFirst({
            where: {
              conversationId: internalConvId,
              body: act.messageBody!,
              isOutbound: true,
            },
            select: { id: true },
          });
          if (bodyMatch) continue;

          const created = await prisma.linkedInMessage.create({
            data: {
              conversationId: internalConvId,
              eventUrn: syntheticUrn,
              senderUrn: "",
              senderName: null,
              body: act.messageBody!,
              isOutbound: true,
              deliveredAt: act.completedAt ?? new Date(),
            },
          });
          rememberLinkedInMessage(messageLookup, created);
        }
      } catch (outboundErr) {
        console.error("[linkedin/sync/push] Failed to attach outbound messages:", outboundErr);
      }

      // Determine if conversation was initiated by worker
      const resolvedPersonId = internalConv.personId ?? personId;
      let initiatedByWorker = false;

      if (resolvedPersonId) {
        // Check if a LinkedInAction exists for this sender+person combo
        const matchingAction = await prisma.linkedInAction.findFirst({
          where: {
            senderId,
            personId: resolvedPersonId,
            actionType: { in: ["message", "connect", "connection_request"] },
            status: "complete",
          },
          select: { id: true },
        });
        if (matchingAction) initiatedByWorker = true;
      }

      // Fallback: if the first message in the conversation is outbound, mark as worker-initiated
      if (!initiatedByWorker && conv.messages.length > 0) {
        const sorted = [...conv.messages].sort(
          (a, b) => a.deliveredAt - b.deliveredAt,
        );
        const firstMsg = sorted[0];
        const firstIsOutbound = resolveLinkedInMessageDirection(
          firstMsg.senderUrn,
          conv.participantUrn,
        ).isOutbound;
        if (firstIsOutbound) initiatedByWorker = true;
      }

      if (initiatedByWorker) {
        await prisma.linkedInConversation.update({
          where: { id: internalConvId },
          data: { initiatedByWorker: true },
        });
      }

      // Increment unread count and notify for new inbound messages
      if (newInboundCount > 0 && latestInboundBody) {
        totalNewInbound += newInboundCount;
        await prisma.linkedInConversation.update({
          where: { id: internalConvId },
          data: { unreadCount: { increment: newInboundCount } },
        });
        await notifyLinkedInMessage({
          workspaceSlug,
          participantName: conv.participantName,
          participantProfileUrl: conv.participantProfileUrl,
          messageBody: latestInboundBody,
          conversationId: internalConvId,
        });

        // Cancel pending automated actions when prospect replies
        try {
          const resolvedPid = internalConv.personId ?? personId;
          if (resolvedPid) {
            const cancelled = await cancelActionsForPerson(resolvedPid, workspaceSlug);
            if (cancelled > 0) {
              console.log(`[linkedin-sync-push] Cancelled ${cancelled} pending actions for person ${resolvedPid} after inbound reply`);
            }
          }
        } catch (err) {
          console.error(`[linkedin-sync-push] Failed to cancel actions for person:`, err);
        }
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
