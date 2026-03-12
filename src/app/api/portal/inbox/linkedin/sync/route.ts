import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { syncLinkedInConversations } from "@/lib/linkedin/sync";

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * POST /api/portal/inbox/linkedin/sync
 *
 * Returns 202 + existing conversations immediately, triggering async worker sync.
 * Returns 200 + existing conversations when all senders are within the 5-min cooldown.
 *
 * The client should show existing conversations instantly. Normal 15s polling
 * picks up fresh data once the async sync completes.
 */
export async function POST() {
  // 1. Authenticate portal session
  let workspaceSlug: string;
  try {
    const session = await getPortalSession();
    workspaceSlug = session.workspaceSlug;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Load active LinkedIn senders for this workspace
  // Note: do NOT filter by sessionStatus — senders with expired sessions still
  // have previously-synced conversations we want to show.
  const senders = await prisma.sender.findMany({
    where: { workspaceSlug, status: "active" },
    select: { id: true },
  });

  // 3. Load sync statuses for these senders
  const senderIds = senders.map((s) => s.id);
  const syncStatuses = await prisma.linkedInSyncStatus.findMany({
    where: { senderId: { in: senderIds } },
  });

  // 4. Determine which senders need a sync (outside 5-min cooldown)
  const now = Date.now();
  const sendersToSync = senders.filter((s) => {
    const status = syncStatuses.find((ss) => ss.senderId === s.id);
    if (!status?.lastSyncedAt) return true;
    return now - status.lastSyncedAt.getTime() > COOLDOWN_MS;
  });

  // 5. Fetch existing conversations from DB (always returned, regardless of sync status)
  const conversations = await prisma.linkedInConversation.findMany({
    where: { workspaceSlug },
    orderBy: { lastActivityAt: "desc" },
    take: 50,
  });

  // 6. Compute most recent lastSyncedAt across all senders
  const lastSyncedAt =
    syncStatuses.length > 0
      ? syncStatuses.reduce<Date | null>((latest, ss) => {
          if (!ss.lastSyncedAt) return latest;
          if (!latest || ss.lastSyncedAt > latest) return ss.lastSyncedAt;
          return latest;
        }, null)
      : null;

  // 7. Fire async sync for senders outside cooldown (fire-and-forget)
  // Intentional fire-and-forget: returns 202 immediately while sync runs in background.
  // This is a portal UX pattern, not a webhook handler — acceptable per Phase 43 cleanup scope.
  const syncing = sendersToSync.length > 0;
  if (syncing) {
    void Promise.allSettled(sendersToSync.map((s) => syncLinkedInConversations(s.id)));
  }

  // 8. Return 202 if syncing started, 200 if all within cooldown
  return NextResponse.json(
    { conversations, lastSyncedAt, syncing },
    { status: syncing ? 202 : 200 }
  );
}
