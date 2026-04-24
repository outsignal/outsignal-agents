import { createHash } from "node:crypto";

import { resolveLinkedInMessageDirection } from "@/lib/linkedin/messages";
import {
  extractLinkedInMessageId,
  extractLinkedInProfileId,
} from "@/lib/linkedin/urn";

export interface LinkedInMessageCleanupRecord {
  id: string;
  conversationId: string;
  conversationExternalId: string;
  workspaceSlug: string;
  participantUrn: string | null;
  eventUrn: string;
  senderUrn: string;
  body: string;
  isOutbound: boolean;
  deliveredAt: Date;
}

export interface LinkedInMessageDuplicateGroup {
  workspaceSlug: string;
  conversationId: string;
  conversationExternalId: string;
  dedupKey: string;
  dedupMethod: "canonical" | "composite";
  keptMessageId: string;
  deletedMessageIds: string[];
  correctIsOutbound: boolean;
  keepNeedsDirectionUpdate: boolean;
  rationale: string;
}

const MIN_COMPOSITE_BODY_LENGTH = 30;

function hashLinkedInMessageBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function sortMessagesForRetention(
  messages: LinkedInMessageCleanupRecord[],
): LinkedInMessageCleanupRecord[] {
  return [...messages].sort((a, b) => {
    const aHasCanonical = extractLinkedInMessageId(a.eventUrn) ? 1 : 0;
    const bHasCanonical = extractLinkedInMessageId(b.eventUrn) ? 1 : 0;
    if (aHasCanonical !== bHasCanonical) return bHasCanonical - aHasCanonical;

    const deliveredDelta = a.deliveredAt.getTime() - b.deliveredAt.getTime();
    if (deliveredDelta !== 0) return deliveredDelta;

    return a.id.localeCompare(b.id);
  });
}

function buildCompositeGroupKey(message: LinkedInMessageCleanupRecord): string {
  const senderProfileId =
    extractLinkedInProfileId(message.senderUrn) ?? message.senderUrn ?? "unknown";
  return `${hashLinkedInMessageBody(message.body)}:${senderProfileId}`;
}

function canUseCompositeFallback(message: LinkedInMessageCleanupRecord): boolean {
  return message.body.trim().length >= MIN_COMPOSITE_BODY_LENGTH;
}

function decideDuplicateGroup(
  dedupMethod: "canonical" | "composite",
  dedupKey: string,
  messages: LinkedInMessageCleanupRecord[],
): LinkedInMessageDuplicateGroup | null {
  if (messages.length < 2) return null;

  const sortedMessages = sortMessagesForRetention(messages);
  const correctlyDirected = sortedMessages.filter((message) => {
    const direction = resolveLinkedInMessageDirection(
      message.senderUrn,
      message.participantUrn,
    );
    return message.isOutbound === direction.isOutbound;
  });

  const keptMessage = correctlyDirected[0] ?? sortedMessages[0];
  const keptDirection = resolveLinkedInMessageDirection(
    keptMessage.senderUrn,
    keptMessage.participantUrn,
  );

  return {
    workspaceSlug: keptMessage.workspaceSlug,
    conversationId: keptMessage.conversationId,
    conversationExternalId: keptMessage.conversationExternalId,
    dedupKey,
    dedupMethod,
    keptMessageId: keptMessage.id,
    deletedMessageIds: sortedMessages
      .filter((message) => message.id !== keptMessage.id)
      .map((message) => message.id),
    correctIsOutbound: keptDirection.isOutbound,
    keepNeedsDirectionUpdate: keptMessage.isOutbound !== keptDirection.isOutbound,
    rationale:
      correctlyDirected.length > 0
        ? `Kept ${keptMessage.id} because its stored direction already matched the normalized participant comparison`
        : `Kept ${keptMessage.id} as the best candidate and will normalize its direction from participant comparison`,
  };
}

export function findLinkedInMessageDuplicateGroups(
  messages: LinkedInMessageCleanupRecord[],
): LinkedInMessageDuplicateGroup[] {
  const groups: LinkedInMessageDuplicateGroup[] = [];
  const messagesByConversation = new Map<string, LinkedInMessageCleanupRecord[]>();

  for (const message of messages) {
    const bucket = messagesByConversation.get(message.conversationId) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversationId, bucket);
  }

  for (const conversationMessages of messagesByConversation.values()) {
    const consumedMessageIds = new Set<string>();

    const canonicalGroups = new Map<string, LinkedInMessageCleanupRecord[]>();
    for (const message of conversationMessages) {
      const canonicalMessageId = extractLinkedInMessageId(message.eventUrn);
      if (!canonicalMessageId) continue;
      const bucket = canonicalGroups.get(canonicalMessageId) ?? [];
      bucket.push(message);
      canonicalGroups.set(canonicalMessageId, bucket);
    }

    for (const [canonicalMessageId, canonicalMessages] of canonicalGroups.entries()) {
      const decision = decideDuplicateGroup(
        "canonical",
        canonicalMessageId,
        canonicalMessages,
      );
      if (!decision) continue;
      groups.push(decision);
      for (const message of canonicalMessages) {
        consumedMessageIds.add(message.id);
      }
    }

    const remainingMessages = conversationMessages
      .filter((message) => !consumedMessageIds.has(message.id))
      .sort((a, b) => a.deliveredAt.getTime() - b.deliveredAt.getTime());

    const compositeBuckets = new Map<string, LinkedInMessageCleanupRecord[]>();
    for (const message of remainingMessages) {
      if (!canUseCompositeFallback(message)) {
        continue;
      }

      const bucketKey = buildCompositeGroupKey(message);
      const bucket = compositeBuckets.get(bucketKey) ?? [];
      bucket.push(message);
      compositeBuckets.set(bucketKey, bucket);
    }

    for (const [bucketKey, bucketMessages] of compositeBuckets.entries()) {
      let cluster: LinkedInMessageCleanupRecord[] = [];

      for (const message of bucketMessages) {
        if (cluster.length === 0) {
          cluster = [message];
          continue;
        }

        const previous = cluster[cluster.length - 1];
        const withinOneSecond =
          Math.abs(message.deliveredAt.getTime() - previous.deliveredAt.getTime()) <=
          1000;

        if (withinOneSecond) {
          cluster.push(message);
          continue;
        }

        const decision = decideDuplicateGroup("composite", bucketKey, cluster);
        if (decision) {
          groups.push(decision);
        }
        cluster = [message];
      }

      const finalDecision = decideDuplicateGroup("composite", bucketKey, cluster);
      if (finalDecision) {
        groups.push(finalDecision);
      }
    }
  }

  return groups;
}
