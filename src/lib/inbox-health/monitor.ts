import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

/**
 * Age buckets for disconnected inboxes.
 *
 * - new: first observed disconnect within the last 24h — treat as urgent
 *   (needs investigation).
 * - persistent: disconnected for 3-7 days — known issue, still warrants
 *   an elevated warning in the daily digest.
 * - critical: disconnected for more than 7 days — explicit "needs
 *   immediate action" alert; these are the cases that were getting lost
 *   in the previous flat "new + persistent" alert.
 *
 * Inboxes aged 1-3 days fall between "new" and "persistent" and are
 * reported as part of `newDisconnections` (since the state is still
 * changing). A separate `neverConnected` bucket covers provisioning
 * stalls (see `DisconnectedEntry.neverConnected`).
 */
export interface DisconnectedEntry {
  email: string;
  /** ISO timestamp of the first snapshot that observed the disconnect. */
  firstDisconnectedAt: string;
  /** Age in whole days since `firstDisconnectedAt`. */
  ageDays: number;
  /**
   * True when the underlying Sender row was never authenticated
   * (sessionConnectedAt is null AND sessionStatus='not_setup'). These
   * are provisioning stalls, not real disconnects.
   */
  neverConnected: boolean;
}

export interface InboxStatusChange {
  workspaceSlug: string;
  workspaceName: string;
  /** Disconnections first observed in this run (ageDays === 0). */
  newDisconnections: DisconnectedEntry[];
  /** Disconnected 1-3 days — transitional, reported with new. */
  recentDisconnections: DisconnectedEntry[];
  /** Disconnected 3-7 days — elevated warning. */
  persistentDisconnections: DisconnectedEntry[];
  /** Disconnected >7 days — critical, needs immediate action. */
  criticalDisconnections: DisconnectedEntry[];
  /**
   * Inboxes that were provisioned in EmailBison but never authenticated.
   * Reported in a separate "needs onboarding" alert — these are not
   * real disconnects, and clubbing them with real disconnects was what
   * hid the 1210-solutions issue for 14 days.
   */
  staleProvisioning: DisconnectedEntry[];
  reconnections: string[];
  totalDisconnected: number;
  totalConnected: number;
  /**
   * True when any age bucket contains >=1 entry with ageDays > 7.
   * Callers use this to decide whether to emit the critical alert.
   */
  hasCritical: boolean;
}

/** Thresholds (days) — kept as constants so tests and alerts agree. */
export const AGE_THRESHOLDS = {
  NEW_MAX_DAYS: 1,
  PERSISTENT_MIN_DAYS: 3,
  PERSISTENT_MAX_DAYS: 7,
  CRITICAL_MIN_DAYS: 7,
} as const;

export async function checkAllWorkspaces(): Promise<InboxStatusChange[]> {
  // Get all workspaces with API tokens
  const workspaces = await prisma.workspace.findMany({
    where: { apiToken: { not: null }, monitoringEnabled: true },
    select: { slug: true, name: true, apiToken: true },
  });

  const results: InboxStatusChange[] = [];

  for (const ws of workspaces) {
    if (!ws.apiToken) continue;
    try {
      const result = await checkWorkspace(ws.slug, ws.name, ws.apiToken);
      if (result) results.push(result);
    } catch (err) {
      console.error(`[inbox-health] Failed to check workspace ${ws.slug}:`, err);
    }
  }

  return results;
}

/**
 * Parse the `disconnectedEmails` snapshot JSON. Supports two shapes:
 *
 * 1. Legacy: `string[]` of email addresses (pre-age-tracking). For these
 *    we have no age information, so we treat them as newly observed on
 *    this run.
 * 2. Current: `{ email, firstDisconnectedAt }[]` — persisted age info.
 */
function parseDisconnectedEmailsJson(
  raw: string | null | undefined,
): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return {};

    const out: Record<string, string> = {};
    for (const entry of parsed) {
      if (typeof entry === "string") {
        // legacy shape — age unknown, synthesise "now" so these flip to
        // persistent on the next check rather than staying new forever.
        out[entry] = new Date().toISOString();
      } else if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { email?: unknown }).email === "string"
      ) {
        const e = entry as { email: string; firstDisconnectedAt?: unknown };
        out[e.email] =
          typeof e.firstDisconnectedAt === "string"
            ? e.firstDisconnectedAt
            : new Date().toISOString();
      }
    }
    return out;
  } catch {
    return {};
  }
}

function ageInDays(fromIso: string): number {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return 0;
  const diffMs = Date.now() - from;
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

async function checkWorkspace(
  slug: string,
  name: string,
  apiToken: string,
): Promise<InboxStatusChange | null> {
  const client = new EmailBisonClient(apiToken);
  const senderEmails = await client.getSenderEmails();

  // Build current status map
  const currentStatuses: Record<string, string> = {};
  for (const sender of senderEmails) {
    currentStatuses[sender.email] = sender.status ?? "Unknown";
  }

  // Load previous snapshot
  const previous = await prisma.inboxStatusSnapshot.findUnique({
    where: { workspaceSlug: slug },
  });

  const prevStatuses: Record<string, string> = previous
    ? JSON.parse(previous.statuses)
    : {};
  const prevDisconnectedSince = parseDisconnectedEmailsJson(
    previous?.disconnectedEmails,
  );

  // Load sender rows so we can identify provisioning stalls (never-auth).
  // Keyed by lowercase email for case-insensitive matching against
  // EmailBison responses.
  const senderRows = await prisma.sender.findMany({
    where: {
      workspaceSlug: slug,
      emailAddress: { not: null },
    },
    select: {
      emailAddress: true,
      sessionStatus: true,
      sessionConnectedAt: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
  const senderByEmail = new Map<
    string,
    (typeof senderRows)[number]
  >();
  for (const row of senderRows) {
    if (row.emailAddress) {
      senderByEmail.set(row.emailAddress.toLowerCase(), row);
    }
  }

  // Compute diffs
  const now = new Date();
  const disconnectedEntries: DisconnectedEntry[] = [];
  // Snapshot persistence: email -> firstDisconnectedAt ISO string
  const nextDisconnectedSince: Record<string, string> = {};
  const reconnections: string[] = [];

  for (const [email, status] of Object.entries(currentStatuses)) {
    if (status === "Connected") {
      // Currently connected — was it previously disconnected?
      if (prevDisconnectedSince[email] !== undefined) {
        reconnections.push(email);
      }
      continue;
    }

    // Currently disconnected.
    const firstDisconnectedAt =
      prevDisconnectedSince[email] ?? now.toISOString();
    nextDisconnectedSince[email] = firstDisconnectedAt;

    const senderRow = senderByEmail.get(email.toLowerCase());
    // "Never connected" heuristic: Sender row exists, has never
    // authenticated (sessionConnectedAt null + sessionStatus not_setup).
    // Fall back to false when we have no Sender row (i.e. an inbox only
    // exists in EmailBison and hasn't been synced).
    const neverConnected = senderRow
      ? senderRow.sessionConnectedAt === null &&
        senderRow.sessionStatus === "not_setup"
      : false;

    // For never-connected inboxes, prefer Sender.createdAt to compute
    // "days since provisioning" rather than "days since we first
    // noticed". That gives a more accurate age for the onboarding alert
    // (1210-solutions shows 14 days because the Senders were created
    // 14 days ago, even though the monitor only started flagging this
    // week).
    const ageAnchor =
      neverConnected && senderRow
        ? senderRow.createdAt.toISOString()
        : firstDisconnectedAt;

    disconnectedEntries.push({
      email,
      firstDisconnectedAt,
      ageDays: ageInDays(ageAnchor),
      neverConnected,
    });
  }

  // Upsert snapshot — store as object-shape JSON so we retain age info.
  const persistShape = Object.entries(nextDisconnectedSince).map(
    ([email, firstDisconnectedAt]) => ({ email, firstDisconnectedAt }),
  );
  await prisma.inboxStatusSnapshot.upsert({
    where: { workspaceSlug: slug },
    create: {
      workspaceSlug: slug,
      statuses: JSON.stringify(currentStatuses),
      disconnectedEmails: JSON.stringify(persistShape),
    },
    update: {
      statuses: JSON.stringify(currentStatuses),
      disconnectedEmails: JSON.stringify(persistShape),
      checkedAt: new Date(),
    },
  });

  // Bucket entries.
  // Rules (applied in order, first match wins):
  //   - staleProvisioning: neverConnected === true (regardless of age)
  //   - criticalDisconnections: ageDays > CRITICAL_MIN_DAYS (7)
  //   - persistentDisconnections: ageDays >= PERSISTENT_MIN_DAYS (3)
  //   - newDisconnections: ageDays <= NEW_MAX_DAYS (1) AND the sender
  //       was either Connected or unknown in the previous snapshot
  //       (i.e. genuinely new this run)
  //   - recentDisconnections: 1 < ageDays < 3 (transitional)
  const newDisconnections: DisconnectedEntry[] = [];
  const recentDisconnections: DisconnectedEntry[] = [];
  const persistentDisconnections: DisconnectedEntry[] = [];
  const criticalDisconnections: DisconnectedEntry[] = [];
  const staleProvisioning: DisconnectedEntry[] = [];

  for (const entry of disconnectedEntries) {
    if (entry.neverConnected) {
      staleProvisioning.push(entry);
      continue;
    }
    if (entry.ageDays > AGE_THRESHOLDS.CRITICAL_MIN_DAYS) {
      criticalDisconnections.push(entry);
      continue;
    }
    if (entry.ageDays >= AGE_THRESHOLDS.PERSISTENT_MIN_DAYS) {
      persistentDisconnections.push(entry);
      continue;
    }
    if (entry.ageDays <= AGE_THRESHOLDS.NEW_MAX_DAYS) {
      // Only treat as "new" if the previous status wasn't already
      // disconnected. Otherwise it's a transitional case.
      const prevStatus = prevStatuses[entry.email];
      if (prevStatus === "Connected" || prevStatus === undefined) {
        newDisconnections.push(entry);
      } else {
        recentDisconnections.push(entry);
      }
      continue;
    }
    recentDisconnections.push(entry);
  }

  const totalConnected = senderEmails.filter(
    (s) => (s.status ?? "Unknown") === "Connected",
  ).length;

  const totalDisconnected = disconnectedEntries.length;

  // Return null only when there's genuinely nothing to report.
  if (
    newDisconnections.length === 0 &&
    recentDisconnections.length === 0 &&
    persistentDisconnections.length === 0 &&
    criticalDisconnections.length === 0 &&
    staleProvisioning.length === 0 &&
    reconnections.length === 0
  ) {
    return null;
  }

  return {
    workspaceSlug: slug,
    workspaceName: name,
    newDisconnections,
    recentDisconnections,
    persistentDisconnections,
    criticalDisconnections,
    staleProvisioning,
    reconnections,
    totalDisconnected,
    totalConnected,
    hasCritical: criticalDisconnections.length > 0,
  };
}
