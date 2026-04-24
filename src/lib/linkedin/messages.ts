import {
  extractLinkedInMessageId,
  extractLinkedInProfileId,
} from "@/lib/linkedin/urn";

export interface LinkedInStoredMessageSnapshot {
  id: string;
  eventUrn: string;
  senderUrn: string;
  senderName: string | null;
  body: string;
  isOutbound: boolean;
  deliveredAt: Date;
}

export interface LinkedInIncomingMessageSnapshot {
  eventUrn: string;
  senderUrn: string;
  senderName: string | null;
  body: string;
  isOutbound: boolean;
}

interface LinkedInMessageLookup {
  byEventUrn: Map<string, LinkedInStoredMessageSnapshot>;
  byCanonicalId: Map<string, LinkedInStoredMessageSnapshot>;
}

export type LinkedInMessageMatch =
  | { matchedBy: "eventUrn"; entry: LinkedInStoredMessageSnapshot }
  | { matchedBy: "canonicalId"; entry: LinkedInStoredMessageSnapshot }
  | { matchedBy: null; entry: null };

export interface LinkedInMessageDirection {
  isOutbound: boolean;
  senderProfileId: string | null;
  participantProfileId: string | null;
  confident: boolean;
}

export function resolveLinkedInMessageDirection(
  senderUrn: string | null | undefined,
  participantUrn: string | null | undefined,
): LinkedInMessageDirection {
  const senderProfileId = extractLinkedInProfileId(senderUrn);
  const participantProfileId = extractLinkedInProfileId(participantUrn);

  if (!senderProfileId || !participantProfileId) {
    return {
      isOutbound: false,
      senderProfileId,
      participantProfileId,
      confident: false,
    };
  }

  return {
    isOutbound: senderProfileId !== participantProfileId,
    senderProfileId,
    participantProfileId,
    confident: true,
  };
}

export function buildLinkedInMessageLookup(
  messages: LinkedInStoredMessageSnapshot[],
): LinkedInMessageLookup {
  const byEventUrn = new Map<string, LinkedInStoredMessageSnapshot>();
  const byCanonicalId = new Map<string, LinkedInStoredMessageSnapshot>();

  for (const message of messages) {
    byEventUrn.set(message.eventUrn, message);

    const canonicalMessageId = extractLinkedInMessageId(message.eventUrn);
    if (canonicalMessageId && !byCanonicalId.has(canonicalMessageId)) {
      byCanonicalId.set(canonicalMessageId, message);
    }
  }

  return { byEventUrn, byCanonicalId };
}

export function findLinkedInMessageMatch(
  lookup: LinkedInMessageLookup,
  eventUrn: string,
): LinkedInMessageMatch {
  const exactMatch = lookup.byEventUrn.get(eventUrn);
  if (exactMatch) {
    return { matchedBy: "eventUrn", entry: exactMatch };
  }

  const canonicalMessageId = extractLinkedInMessageId(eventUrn);
  if (!canonicalMessageId) {
    return { matchedBy: null, entry: null };
  }

  const canonicalMatch = lookup.byCanonicalId.get(canonicalMessageId);
  if (canonicalMatch) {
    return { matchedBy: "canonicalId", entry: canonicalMatch };
  }

  return { matchedBy: null, entry: null };
}

export function rememberLinkedInMessage(
  lookup: LinkedInMessageLookup,
  message: LinkedInStoredMessageSnapshot,
): void {
  lookup.byEventUrn.set(message.eventUrn, message);

  const canonicalMessageId = extractLinkedInMessageId(message.eventUrn);
  if (canonicalMessageId && !lookup.byCanonicalId.has(canonicalMessageId)) {
    lookup.byCanonicalId.set(canonicalMessageId, message);
  }
}

export function mergeLinkedInMessageSnapshot(
  existing: LinkedInStoredMessageSnapshot,
  patch: Partial<LinkedInStoredMessageSnapshot>,
): LinkedInStoredMessageSnapshot {
  return {
    ...existing,
    ...patch,
  };
}

export function getLinkedInMessageUpdatePatch(
  existing: LinkedInStoredMessageSnapshot,
  incoming: LinkedInIncomingMessageSnapshot,
): Partial<LinkedInStoredMessageSnapshot> | null {
  const patch: Partial<LinkedInStoredMessageSnapshot> = {};

  if (incoming.senderUrn && incoming.senderUrn !== existing.senderUrn) {
    patch.senderUrn = incoming.senderUrn;
  }

  if (incoming.senderName && incoming.senderName !== existing.senderName) {
    patch.senderName = incoming.senderName;
  }

  if (
    incoming.body &&
    incoming.body !== existing.body &&
    incoming.body.length > existing.body.length
  ) {
    patch.body = incoming.body;
  }

  if (incoming.isOutbound !== existing.isOutbound) {
    patch.isOutbound = incoming.isOutbound;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
