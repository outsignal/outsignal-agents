import { prisma } from "@/lib/db";
import { notifySessionDrop } from "@/lib/notifications";

/**
 * Find active senders with stale LinkedIn sessions and flag them as expired.
 *
 * Detection priority:
 * 1. If lastKeepaliveAt exists and is >8h old → expired (keepalive should fire every 4-6h)
 * 2. Fallback: if updatedAt >6 days old → expired (legacy check)
 *
 * Extracted from /api/cron/session-refresh so it can be called
 * from the consolidated inbox-health/check cron as well.
 */
export async function refreshStaleSessions(): Promise<{
  count: number;
  senders: string[];
}> {
  const EIGHT_HOURS_AGO = new Date(Date.now() - 8 * 60 * 60 * 1000);
  const SIX_DAYS_AGO = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

  // Find active senders with stale keepalive OR stale updatedAt
  const staleSenders = await prisma.sender.findMany({
    where: {
      status: "active",
      sessionStatus: "active",
      sessionData: { not: null },
      OR: [
        // Keepalive-based: has keepalive tracking but it's stale (>8h)
        { lastKeepaliveAt: { not: null, lt: EIGHT_HOURS_AGO } },
        // Legacy fallback: no keepalive tracking, session older than 6 days
        { lastKeepaliveAt: null, updatedAt: { lt: SIX_DAYS_AGO } },
      ],
    },
    select: {
      id: true,
      name: true,
      emailAddress: true,
      workspaceSlug: true,
      lastKeepaliveAt: true,
      updatedAt: true,
      workspace: { select: { name: true } },
    },
  });

  if (staleSenders.length === 0) {
    return { count: 0, senders: [] };
  }

  // Flag each stale sender for re-auth
  // Set sessionStatus to 'expired' -- this prevents the worker from using them
  // and signals to the admin that re-auth is needed (visible on sender cards)
  const flagged: string[] = [];
  for (const sender of staleSenders) {
    const staleSource = sender.lastKeepaliveAt
      ? `keepalive stale: last at ${sender.lastKeepaliveAt.toISOString()}, >8h ago`
      : `session last updated ${sender.updatedAt.toISOString()}, >6 days ago`;

    await prisma.sender.update({
      where: { id: sender.id },
      data: {
        sessionStatus: "expired",
        healthStatus: "session_expired",
      },
    });

    // Create a health event for audit trail
    await prisma.senderHealthEvent.create({
      data: {
        senderId: sender.id,
        status: "session_expired",
        reason: "session_expired",
        detail: `Proactive session refresh: ${staleSource}`,
      },
    });

    // Alert on session drop
    notifySessionDrop({
      senderName: sender.name,
      senderEmail: sender.emailAddress ?? null,
      workspaceSlug: sender.workspaceSlug,
      workspaceName: sender.workspace.name,
      sessionDownSince: sender.lastKeepaliveAt ?? sender.updatedAt,
    }).catch((err) => console.error("[Session Refresh] Alert failed:", err));

    flagged.push(`${sender.name} (${sender.workspaceSlug})`);
  }

  console.log(
    `[Session Refresh] Flagged ${flagged.length} stale sender sessions:`,
    flagged,
  );

  return { count: flagged.length, senders: flagged };
}
