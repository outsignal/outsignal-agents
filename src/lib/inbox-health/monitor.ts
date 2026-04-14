import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

/**
 * Age buckets for disconnected inboxes.
 *
 * Boundaries (inclusive on the first-listed side; integer days via
 * Math.floor, so a 23-hour disconnect is still ageDays=0):
 *
 * - new:        ageDays 0-1, and prior status was Connected or unknown.
 *               Fresh disconnect, worth investigating immediately.
 * - recent:     ageDays 0-2 with prior status Disconnected (transitional —
 *               we've seen it disconnected for more than one tick but
 *               less than the persistent threshold). In practice, with
 *               daily ticks, this bucket fires mostly at ageDays=1 or
 *               ageDays=2.
 * - persistent: ageDays 3-6. Known-bad state, elevated warning in digest.
 * - critical:   ageDays >= 7. "Needs immediate action" alert; inclusive at
 *               day 7 (Finding 2.2 — previous `>` let ageDays=7 fall into
 *               persistent).
 *
 * A separate `neverConnected` bucket covers provisioning stalls — see
 * `DisconnectedEntry.neverConnected`. Those always land in
 * `staleProvisioning` regardless of age.
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
  /** Disconnections first observed this run (ageDays 0-1, no prior disconnect). */
  newDisconnections: DisconnectedEntry[];
  /** Transitional (1-2 days) — prior status was Disconnected. */
  recentDisconnections: DisconnectedEntry[];
  /** Disconnected 3-6 days — elevated warning. */
  persistentDisconnections: DisconnectedEntry[];
  /** Disconnected >=7 days — critical, needs immediate action. */
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

/**
 * Thresholds (days) — kept as constants so tests and alerts agree.
 *
 * Bucketing is applied in this order, first match wins:
 *   - staleProvisioning: neverConnected === true (regardless of age)
 *   - criticalDisconnections: ageDays >= CRITICAL_MIN_DAYS_INCLUSIVE (7)
 *   - persistentDisconnections: ageDays >= PERSISTENT_MIN_DAYS (3) — so 3-6
 *   - newDisconnections: ageDays <= NEW_MAX_DAYS (1) AND previously
 *       connected (or unknown)
 *   - recentDisconnections: everything else — i.e. ageDays=2, or ageDays<=1
 *       with a prior disconnected status. This bucket captures the
 *       transitional state between "just noticed" and "persistent".
 *
 * Inclusive semantics at the boundaries matter: an inbox with ageDays === 7
 * is critical (not persistent). This was Finding 2.2 — the previous `>`
 * comparison let 7-day-old disconnects slip into the persistent bucket.
 */
export const AGE_THRESHOLDS = {
  NEW_MAX_DAYS: 1,
  PERSISTENT_MIN_DAYS: 3,
  CRITICAL_MIN_DAYS_INCLUSIVE: 7,
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
 * 1. Legacy: `string[]` of email addresses (pre-age-tracking). We have no
 *    per-email age info, so we use the previous snapshot's `checkedAt`
 *    as the synthesised `firstDisconnectedAt`. That preserves at least
 *    the snapshot's own age — if the legacy snapshot is 14 days old the
 *    inbox gets ageDays=14 on first run after deploy, not ageDays=0.
 *    Only if no `previousCheckedAt` is available do we fall back to now()
 *    (first-ever run, impossible without a snapshot anyway).
 * 2. Current: `{ email, firstDisconnectedAt }[]` — persisted age info is
 *    used verbatim.
 *
 * Keys are lowercased for case-insensitive matching with EmailBison
 * responses (which can return mixed-case addresses).
 */
function parseDisconnectedEmailsJson(
  raw: string | null | undefined,
  previousCheckedAt?: Date | null,
): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return {};

    // Legacy fallback: prefer the previous snapshot's checkedAt so we
    // preserve age across the shape migration. Blocker 2.1 fix.
    const legacyFallback =
      previousCheckedAt instanceof Date && !Number.isNaN(previousCheckedAt.getTime())
        ? previousCheckedAt.toISOString()
        : new Date().toISOString();

    const out: Record<string, string> = {};
    for (const entry of parsed) {
      if (typeof entry === "string") {
        out[normEmail(entry)] = legacyFallback;
      } else if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as { email?: unknown }).email === "string"
      ) {
        const e = entry as { email: string; firstDisconnectedAt?: unknown };
        out[normEmail(e.email)] =
          typeof e.firstDisconnectedAt === "string"
            ? e.firstDisconnectedAt
            : legacyFallback;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Normalise an email for dictionary lookup / comparison.
 *
 * - `trim()` strips accidental whitespace (some providers include trailing
 *   newlines in stored addresses).
 * - `normalize("NFC")` canonicalises Unicode composition so accented
 *   domains compare equal regardless of whether they're stored as
 *   precomposed or decomposed forms. Cold outbound rarely hits Unicode
 *   addresses but provisioning imports from spreadsheets sometimes do.
 * - `toLowerCase()` makes lookups case-insensitive, matching what the
 *   snapshot JSON and EmailBison responses expect.
 *
 * All four inputs — EmailBison response, Sender row, previous snapshot
 * keys, legacy snapshot shape — go through this helper so the keyspace
 * is consistent. (QA-005)
 */
function normEmail(raw: string): string {
  return raw.trim().normalize("NFC").toLowerCase();
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

  // Build current status map. Keys are lowercased so we stay consistent
  // with Sender rows (which we key by lowercase email) and with the
  // persisted snapshot (also lowercased — Finding 2.4).
  const currentStatuses: Record<string, string> = {};
  for (const sender of senderEmails) {
    currentStatuses[normEmail(sender.email)] = sender.status ?? "Unknown";
  }

  // Load previous snapshot
  const previous = await prisma.inboxStatusSnapshot.findUnique({
    where: { workspaceSlug: slug },
  });

  // Re-parse previous statuses and lowercase the keys so comparisons are
  // case-insensitive even if an older snapshot stored mixed-case addresses.
  const prevStatuses: Record<string, string> = {};
  if (previous) {
    const rawPrev = JSON.parse(previous.statuses) as Record<string, string>;
    for (const [email, status] of Object.entries(rawPrev)) {
      prevStatuses[normEmail(email)] = status;
    }
  }
  const prevDisconnectedSince = parseDisconnectedEmailsJson(
    previous?.disconnectedEmails,
    previous?.checkedAt ?? null,
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
      senderByEmail.set(normEmail(row.emailAddress), row);
    }
  }

  // Compute diffs
  const now = new Date();
  const disconnectedEntries: DisconnectedEntry[] = [];
  // Snapshot persistence: email -> firstDisconnectedAt ISO string
  const nextDisconnectedSince: Record<string, string> = {};
  const reconnections: string[] = [];

  for (const [email, status] of Object.entries(currentStatuses)) {
    // Defensive: normalise key once, then use it for all downstream keys
    // (currentStatuses is already lowercased, this is belt-and-braces).
    const emailKey = normEmail(email);

    if (status === "Connected") {
      // Currently connected — was it previously disconnected?
      if (prevDisconnectedSince[emailKey] !== undefined) {
        reconnections.push(emailKey);
      }
      continue;
    }

    // Currently disconnected.
    const firstDisconnectedAt =
      prevDisconnectedSince[emailKey] ?? now.toISOString();
    nextDisconnectedSince[emailKey] = firstDisconnectedAt;

    const senderRow = senderByEmail.get(emailKey);
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
      email: emailKey,
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
  //   - criticalDisconnections: ageDays >= CRITICAL_MIN_DAYS_INCLUSIVE (7)
  //       (Finding 2.2: was `>`, which let ageDays=7 fall into persistent.)
  //   - persistentDisconnections: ageDays >= PERSISTENT_MIN_DAYS (3) — so 3-6
  //   - newDisconnections: ageDays <= NEW_MAX_DAYS (1) AND the sender
  //       was either Connected or unknown in the previous snapshot
  //       (i.e. genuinely new this run)
  //   - recentDisconnections: everything else — ageDays=2, or ageDays<=1
  //       with a prior disconnected status (transitional).
  const newDisconnections: DisconnectedEntry[] = [];
  const recentDisconnections: DisconnectedEntry[] = [];
  const persistentDisconnections: DisconnectedEntry[] = [];
  const criticalDisconnections: DisconnectedEntry[] = [];
  const staleProvisioning: DisconnectedEntry[] = [];

  for (const entry of disconnectedEntries) {
    if (entry.neverConnected) {
      staleProvisioning.push(entry);
    } else if (entry.ageDays >= AGE_THRESHOLDS.CRITICAL_MIN_DAYS_INCLUSIVE) {
      criticalDisconnections.push(entry);
    } else if (entry.ageDays >= AGE_THRESHOLDS.PERSISTENT_MIN_DAYS) {
      persistentDisconnections.push(entry);
    } else if (entry.ageDays <= AGE_THRESHOLDS.NEW_MAX_DAYS) {
      // Only treat as "new" if the previous status wasn't already
      // disconnected. Otherwise it's a transitional case.
      const prevStatus = prevStatuses[entry.email];
      if (prevStatus === "Connected" || prevStatus === undefined) {
        newDisconnections.push(entry);
      } else {
        recentDisconnections.push(entry);
      }
    } else {
      recentDisconnections.push(entry);
    }
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
