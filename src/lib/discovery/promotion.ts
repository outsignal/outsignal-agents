/**
 * Deduplication and promotion engine for discovered people.
 *
 * Checks staged DiscoveredPerson records against the Person DB using three match legs:
 *   1. Email exact match
 *   2. LinkedIn URL exact match
 *   3. Name + company fuzzy match (Levenshtein at 0.85 threshold)
 *
 * Non-duplicates are promoted to the Person table with a PersonWorkspace junction record.
 * Leads without a verified email are DISCARDED (not promoted) — email verification
 * happens during discovery enrichment, so null email means all providers failed to
 * find a valid email for this person.
 * Promoted leads are enqueued for full-waterfall enrichment via the EnrichmentJob queue.
 * Duplicate records are marked status='duplicate' with personId set (no promotedAt — duplicates are free for quota).
 */

import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/enrichment/queue";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PromotionResult {
  /** Number of DiscoveredPerson records promoted to Person table */
  promoted: number;
  /** Number of DiscoveredPerson records marked as duplicates */
  duplicates: number;
  /** Number of DiscoveredPerson records discarded (no valid email) */
  discarded: number;
  /** Up to 5 sample names of duplicate records (for display) */
  duplicateNames: string[];
  /** Person IDs of newly promoted leads */
  promotedIds: string[];
  /** EnrichmentJob ID if enrichment was enqueued; undefined if no leads were promoted */
  enrichmentJobId?: string;
}

// ---------------------------------------------------------------------------
// String similarity (hand-rolled Levenshtein — no external dependency)
// ---------------------------------------------------------------------------

/**
 * Standard dynamic-programming Levenshtein distance.
 * Returns the edit distance between strings a and b.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Allocate a (m+1) x (n+1) matrix
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );

  // Base cases: transforming empty string to/from prefix
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Normalised string similarity: 1.0 = identical, 0.0 = completely different.
 * Based on Levenshtein distance divided by the length of the longer string.
 */
export function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0; // both empty strings are identical
  return 1 - levenshteinDistance(a, b) / maxLen;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A DiscoveredPerson row as returned by Prisma (minimal fields needed for dedup). */
interface StagedRecord {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  location: string | null;
  discoverySource: string;
  workspaceSlug: string;
}

/**
 * Pre-load all potential matches for a batch of staged records in 3 queries,
 * then resolve matches in-memory. Replaces per-record findExistingPerson.
 */
interface DedupMaps {
  byEmail: Map<string, string>;       // email -> personId
  byLinkedin: Map<string, string>;     // linkedinUrl -> personId
  byDomain: Map<string, Array<{ id: string; firstName: string; lastName: string }>>;
}

async function buildDedupMaps(staged: StagedRecord[]): Promise<DedupMaps> {
  // Collect unique lookup keys
  const emails = staged
    .filter((dp) => dp.email)
    .map((dp) => dp.email!);
  const linkedinUrls = staged
    .filter((dp) => dp.linkedinUrl)
    .map((dp) => dp.linkedinUrl!);
  const domains = [...new Set(
    staged
      .filter((dp) => dp.firstName && dp.lastName && dp.companyDomain)
      .map((dp) => dp.companyDomain!),
  )];

  // 3 batch queries instead of up to 3N
  const [emailMatches, linkedinMatches, domainCandidates] = await Promise.all([
    emails.length > 0
      ? prisma.person.findMany({
          where: { email: { in: emails } },
          select: { id: true, email: true },
        })
      : [],
    linkedinUrls.length > 0
      ? prisma.person.findMany({
          where: { linkedinUrl: { in: linkedinUrls } },
          select: { id: true, linkedinUrl: true },
        })
      : [],
    domains.length > 0
      ? prisma.person.findMany({
          where: { companyDomain: { in: domains } },
          select: { id: true, firstName: true, lastName: true, companyDomain: true },
        })
      : [],
  ]);

  const byEmail = new Map(emailMatches.filter((p) => p.email).map((p) => [p.email!, p.id]));
  const byLinkedin = new Map(
    linkedinMatches.filter((p) => p.linkedinUrl).map((p) => [p.linkedinUrl!, p.id]),
  );

  const byDomain = new Map<string, Array<{ id: string; firstName: string; lastName: string }>>();
  for (const p of domainCandidates) {
    if (!p.companyDomain || !p.firstName || !p.lastName) continue;
    const list = byDomain.get(p.companyDomain) ?? [];
    list.push({ id: p.id, firstName: p.firstName, lastName: p.lastName });
    byDomain.set(p.companyDomain, list);
  }

  return { byEmail, byLinkedin, byDomain };
}

/**
 * Find existing person match using pre-loaded dedup maps (in-memory).
 * Three-leg matching: email → LinkedIn → fuzzy name+domain.
 */
function findExistingPersonFromMaps(dp: StagedRecord, maps: DedupMaps): string | null {
  // Leg 1: Email exact match
  if (dp.email) {
    const match = maps.byEmail.get(dp.email);
    if (match) return match;
  }

  // Leg 2: LinkedIn URL exact match
  if (dp.linkedinUrl) {
    const match = maps.byLinkedin.get(dp.linkedinUrl);
    if (match) return match;
  }

  // Leg 3: Fuzzy name + companyDomain match
  if (dp.firstName && dp.lastName && dp.companyDomain) {
    const candidateName = `${dp.firstName} ${dp.lastName}`.toLowerCase().trim();
    const candidates = maps.byDomain.get(dp.companyDomain) ?? [];

    for (const candidate of candidates) {
      const existingName = `${candidate.firstName} ${candidate.lastName}`.toLowerCase().trim();
      if (stringSimilarity(candidateName, existingName) >= 0.85) {
        return candidate.id;
      }
    }
  }

  return null;
}

/**
 * Promote a staged DiscoveredPerson to the Person table.
 * Creates (or finds) the Person record and ensures a PersonWorkspace junction exists.
 * Returns the Person's ID.
 */
async function promoteToPerson(
  dp: StagedRecord,
  workspaceSlug: string
): Promise<{ id: string }> {
  // Use real email if available; otherwise leave null (schema allows nullable email).
  // No more placeholder @discovery.internal emails.
  const email = dp.email ?? null;

  // Upsert by email (handles race conditions).
  // Null-email records are filtered out before reaching this function.
  const person = await prisma.person.upsert({
    where: { email: email! },
    create: {
      email: email!,
      firstName: dp.firstName ?? null,
      lastName: dp.lastName ?? null,
      jobTitle: dp.jobTitle ?? null,
      company: dp.company ?? null,
      companyDomain: dp.companyDomain ?? null,
      linkedinUrl: dp.linkedinUrl ?? null,
      phone: dp.phone ?? null,
      location: dp.location ?? null,
      source: `discovery-${dp.discoverySource}`,
      status: "new",
    },
    update: {},
    select: { id: true },
  });

  // Upsert PersonWorkspace junction — idempotent
  await prisma.personWorkspace.upsert({
    where: {
      personId_workspace: {
        personId: person.id,
        workspace: workspaceSlug,
      },
    },
    create: {
      personId: person.id,
      workspace: workspaceSlug,
    },
    update: {},
  });

  return person;
}

/**
 * Enqueue a full-waterfall enrichment job for the given Person IDs.
 * Returns the EnrichmentJob ID.
 */
async function triggerEnrichmentForPeople(
  personIds: string[],
  workspaceSlug: string
): Promise<string | undefined> {
  if (personIds.length === 0) return undefined;

  const jobId = await enqueueJob({
    entityType: "person",
    provider: "waterfall",
    entityIds: personIds,
    chunkSize: 25,
    workspaceSlug,
  });

  return jobId;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Deduplicates and promotes staged DiscoveredPerson records to the Person table.
 *
 * Fetches all records with status='staged' for the given workspace and run IDs,
 * runs three-leg dedup against existing Person records, promotes non-duplicates,
 * and enqueues enrichment for promoted leads.
 *
 * @param workspaceSlug - The workspace these records belong to
 * @param runIds - Discovery run IDs to process (filters staged records)
 * @returns PromotionResult with counts, sample duplicate names, promoted IDs, and job ID
 */
export async function deduplicateAndPromote(
  workspaceSlug: string,
  runIds: string[]
): Promise<PromotionResult> {
  // Fetch all staged records for these run IDs
  const staged = await prisma.discoveredPerson.findMany({
    where: {
      workspaceSlug,
      status: "staged",
      discoveryRunId: { in: runIds },
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      jobTitle: true,
      company: true,
      companyDomain: true,
      linkedinUrl: true,
      phone: true,
      location: true,
      discoverySource: true,
      workspaceSlug: true,
    },
  });

  const promotedIds: string[] = [];
  const duplicatePersonIds: string[] = [];
  const duplicateNames: string[] = [];
  let discardedCount = 0;
  const now = new Date();

  // --- Intra-batch dedup (cross-source within the same discovery run) ---
  // When multiple sources (e.g. Prospeo + AI Ark) return the same person,
  // keep the record with more non-null fields and mark the rest as duplicates.
  const seenEmails = new Map<string, number>(); // email -> index in staged
  const seenLinkedins = new Map<string, number>();
  const skipIndices = new Set<number>();

  function countNonNullFields(dp: StagedRecord): number {
    let count = 0;
    if (dp.email) count++;
    if (dp.firstName) count++;
    if (dp.lastName) count++;
    if (dp.jobTitle) count++;
    if (dp.company) count++;
    if (dp.companyDomain) count++;
    if (dp.linkedinUrl) count++;
    if (dp.phone) count++;
    if (dp.location) count++;
    return count;
  }

  for (let i = 0; i < staged.length; i++) {
    const dp = staged[i];
    const email = dp.email ? dp.email.toLowerCase() : null;
    const linkedin = dp.linkedinUrl ?? null;

    // Check email match within batch
    if (email && seenEmails.has(email)) {
      const prevIdx = seenEmails.get(email)!;
      if (!skipIndices.has(prevIdx)) {
        // Keep the record with more data
        if (countNonNullFields(dp) > countNonNullFields(staged[prevIdx])) {
          skipIndices.add(prevIdx);
          seenEmails.set(email, i);
        } else {
          skipIndices.add(i);
        }
        continue;
      }
    }

    // Check LinkedIn match within batch
    if (linkedin && seenLinkedins.has(linkedin)) {
      const prevIdx = seenLinkedins.get(linkedin)!;
      if (!skipIndices.has(prevIdx)) {
        if (countNonNullFields(dp) > countNonNullFields(staged[prevIdx])) {
          skipIndices.add(prevIdx);
          seenLinkedins.set(linkedin, i);
        } else {
          skipIndices.add(i);
        }
        continue;
      }
    }

    if (email) seenEmails.set(email, i);
    if (linkedin) seenLinkedins.set(linkedin, i);
  }

  // Mark intra-batch duplicates
  for (const idx of skipIndices) {
    const dp = staged[idx];
    await prisma.discoveredPerson.update({
      where: { id: dp.id },
      data: { status: "duplicate" },
    });
    duplicatePersonIds.push(dp.id);
    if (duplicateNames.length < 5) {
      const displayName =
        dp.firstName && dp.lastName
          ? `${dp.firstName} ${dp.lastName}`
          : dp.email ?? dp.id;
      duplicateNames.push(`${displayName} (cross-source)`);
    }
  }

  // Pre-load all potential matches in 3 batch queries
  const dedupMaps = await buildDedupMaps(staged);

  for (let i = 0; i < staged.length; i++) {
    if (skipIndices.has(i)) continue; // already handled as intra-batch dupe
    const dp = staged[i];

    // Discard people with no email — email verification happens during discovery
    // enrichment, so null email means no provider found a valid email for this person.
    if (!dp.email) {
      await prisma.discoveredPerson.update({
        where: { id: dp.id },
        data: { status: "discarded" },
      });
      discardedCount++;
      continue;
    }

    const existingPersonId = findExistingPersonFromMaps(dp, dedupMaps);

    if (existingPersonId) {
      // Duplicate — mark as duplicate, set personId, do NOT set promotedAt (free for quota)
      await prisma.discoveredPerson.update({
        where: { id: dp.id },
        data: {
          status: "duplicate",
          personId: existingPersonId,
          // promotedAt intentionally left null — duplicates don't count against quota
        },
      });

      duplicatePersonIds.push(existingPersonId);

      // Collect sample name for display (up to 5)
      if (duplicateNames.length < 5) {
        const displayName =
          dp.firstName && dp.lastName
            ? `${dp.firstName} ${dp.lastName}`
            : dp.email ?? dp.id;
        duplicateNames.push(displayName);
      }
    } else {
      // Not a duplicate — promote to Person table
      const person = await promoteToPerson(dp, workspaceSlug);

      // Update DiscoveredPerson record with promotion details
      await prisma.discoveredPerson.update({
        where: { id: dp.id },
        data: {
          status: "promoted",
          personId: person.id,
          promotedAt: now,
        },
      });

      promotedIds.push(person.id);
    }
  }

  if (discardedCount > 0) {
    console.log(
      `[promotion] Discarded ${discardedCount} people with no valid email`,
    );
  }

  // Enqueue enrichment for all newly promoted leads
  const enrichmentJobId = await triggerEnrichmentForPeople(
    promotedIds,
    workspaceSlug
  );

  return {
    promoted: promotedIds.length,
    duplicates: duplicatePersonIds.length,
    discarded: discardedCount,
    duplicateNames,
    promotedIds,
    enrichmentJobId,
  };
}
