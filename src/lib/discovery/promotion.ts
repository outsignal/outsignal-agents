/**
 * Deduplication and promotion engine for discovered people.
 *
 * Checks staged DiscoveredPerson records against the Person DB using three match legs:
 *   1. Email exact match
 *   2. LinkedIn URL exact match
 *   3. Name + company fuzzy match (Levenshtein at 0.85 threshold)
 *
 * Non-duplicates are promoted to the Person table with a PersonWorkspace junction record.
 * Leads without emails are promoted if they have a LinkedIn URL (enrichment will find
 * emails asynchronously). Leads with neither email nor LinkedIn URL are discarded.
 * Promoted leads are enqueued for full-waterfall enrichment via the EnrichmentJob queue.
 * Duplicate records are marked status='duplicate' with personId set (no promotedAt — duplicates are free for quota).
 */

import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/enrichment/queue";
import {
  ICP_NEEDS_WEBSITE_STATUS,
  scoreStagedPersonIcpBatch,
} from "@/lib/icp/scorer";
import type {
  StagedIcpEvaluationResult,
  StagedPersonBatchInput,
} from "@/lib/icp/scorer";
import { prefetchDomains } from "@/lib/icp/crawl-cache";
import { getExclusionDomains, getExclusionEmails, extractDomain } from "@/lib/exclusions";
import { getCampaignChannels, getEnrichmentProfile } from "@/lib/discovery/channel-enrichment";
import { normalizeJobTitle } from "@/lib/normalize";

// ---------------------------------------------------------------------------
// Safety net: placeholder email domains that must never enter the Person table.
// These are internal sentinel values used during discovery staging — they are
// NOT real addresses. Defence-in-depth guard against stale dist regressions.
// ---------------------------------------------------------------------------
const PLACEHOLDER_EMAIL_DOMAINS = ["@discovery.internal", "@discovered.local"];

/**
 * Returns true if the email is a known placeholder / internal sentinel value.
 * If detected, the caller should set email to null and log a warning.
 */
function isPlaceholderEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return PLACEHOLDER_EMAIL_DOMAINS.some((domain) => lower.endsWith(domain));
}

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
  /** Number of DiscoveredPerson records rejected by ICP scoring (below threshold) */
  scoredRejected: number;
  /** Number of DiscoveredPerson records excluded via workspace exclusion list */
  excluded: number;
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
  sourceId: string | null;
  workspaceSlug: string;
  rawResponse: string | null;
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

/** Optional ICP score data to apply to the PersonWorkspace row during promotion. */
interface PromotionScore {
  icpScore: number;
  icpReasoning: string;
  icpConfidence: "high" | "medium" | "low";
  icpScoredAt: Date;
}

function recordRichnessScore(dp: StagedRecord): number {
  let score = 0;
  const values = [
    dp.email,
    dp.firstName,
    dp.lastName,
    dp.jobTitle,
    dp.company,
    dp.companyDomain,
    dp.linkedinUrl,
    dp.phone,
    dp.location,
  ];

  for (const value of values) {
    if (!value) continue;
    score += 100;
    score += Math.min(value.trim().length, 40);
  }

  return score;
}

async function ensurePersonWorkspaceLink(
  personId: string,
  workspaceSlug: string,
  discoverySourceId: string | null,
  score?: PromotionScore,
): Promise<void> {
  const scorePayload = score
    ? {
        icpScore: score.icpScore,
        icpReasoning: score.icpReasoning,
        icpConfidence: score.icpConfidence,
        icpScoredAt: score.icpScoredAt,
      }
    : {};

  await prisma.personWorkspace.upsert({
    where: {
      personId_workspace: {
        personId,
        workspace: workspaceSlug,
      },
    },
    create: {
      personId,
      workspace: workspaceSlug,
      sourceId: discoverySourceId,
      ...scorePayload,
    },
    update: {
      ...(discoverySourceId ? { sourceId: discoverySourceId } : {}),
      ...scorePayload,
    },
  });
}

/**
 * Promote a staged DiscoveredPerson to the Person table.
 * Creates (or finds) the Person record and ensures a PersonWorkspace junction exists.
 * Returns the Person's ID.
 *
 * Handles two cases:
 * - Has email: upsert by email (standard path)
 * - No email but has LinkedIn URL: upsert by linkedinUrl (discovery-first path)
 *
 * If `score` is provided, the ICP score fields are copied onto the PersonWorkspace
 * row in both the create and update payloads. When omitted, existing score fields
 * are left untouched (never nulled out). This keeps DiscoveredPerson.icpScore and
 * PersonWorkspace.icpScore in sync — required for INV2 audit compliance.
 */
async function promoteToPerson(
  dp: StagedRecord,
  workspaceSlug: string,
  score?: PromotionScore,
): Promise<{ id: string }> {
  const email = dp.email ?? null;

  let person: { id: string };

  if (email) {
    // Standard path: upsert by email
    person = await prisma.person.upsert({
      where: { email },
      create: {
        email,
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
  } else if (dp.linkedinUrl) {
    // Discovery-first path: no email yet, find by LinkedIn URL or create.
    // Enrichment will find email asynchronously via EnrichmentJob.
    const existing = await prisma.person.findFirst({
      where: { linkedinUrl: dp.linkedinUrl },
      select: { id: true },
    });
    if (existing) {
      person = existing;
    } else {
      person = await prisma.person.create({
        data: {
          firstName: dp.firstName ?? null,
          lastName: dp.lastName ?? null,
          jobTitle: dp.jobTitle ?? null,
          company: dp.company ?? null,
          companyDomain: dp.companyDomain ?? null,
          linkedinUrl: dp.linkedinUrl,
          phone: dp.phone ?? null,
          location: dp.location ?? null,
          source: `discovery-${dp.discoverySource}`,
          status: "new",
        },
        select: { id: true },
      });
    }
  } else {
    // No email and no LinkedIn URL — should not reach here (filtered by caller)
    throw new Error(`Cannot promote person ${dp.id}: no email and no LinkedIn URL`);
  }

  // Upsert PersonWorkspace junction — idempotent
  // Preserve discovery sourceId (Prospeo person_id, AI Ark id, etc.) for
  // source-first enrichment: the waterfall can use the original platform's
  // ID for a direct lookup instead of generic name/company matching.
  //
  // When `score` is supplied, the ICP fields are written on both create and
  // update. On update we always override — the fresh batch score is the most
  // recent signal, and we want DiscoveredPerson.icpScore and
  // PersonWorkspace.icpScore to stay in sync (INV2). When `score` is omitted,
  // the spread is empty so existing fields are left untouched.
  // TODO(BL-future): When PersonWorkspace gains an `icpScoreSource` enum
  // (e.g. "auto" | "manual"), gate the score update on
  // `existing.icpScoreSource !== "manual"` to avoid clobbering hand-edited
  // ICP scores during a re-discovery / re-promotion. Tracked in Finding 3.1
  // — schema migration deferred so we don't ship an unmigrated column today.
  await ensurePersonWorkspaceLink(person.id, workspaceSlug, dp.sourceId, score);

  return person;
}

/**
 * Enqueue a full-waterfall enrichment job for the given Person IDs.
 * Returns the EnrichmentJob ID.
 */
async function triggerEnrichmentForPeople(
  personIds: string[],
  workspaceSlug: string,
  enrichmentProfile: "full" | "linkedin-only" = "full",
): Promise<string | undefined> {
  if (personIds.length === 0) return undefined;
  if (enrichmentProfile === "linkedin-only") {
    console.log(
      `[promotion] Skipping email enrichment waterfall for ${personIds.length} promoted lead(s) — LinkedIn-only campaign profile`,
    );
    return undefined;
  }

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
/** Default ICP score threshold when workspace has icpCriteriaPrompt but no explicit threshold */
const DEFAULT_ICP_THRESHOLD = 40;

export async function deduplicateAndPromote(
  workspaceSlug: string,
  runIds: string[],
  options?: { campaignId?: string },
): Promise<PromotionResult> {
  // Fetch workspace config for ICP scoring gate
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: workspaceSlug },
  });
  const icpScoringEnabled = !!workspace.icpCriteriaPrompt?.trim();
  const icpThreshold = workspace.icpScoreThreshold ?? DEFAULT_ICP_THRESHOLD;
  let enrichmentProfile: "full" | "linkedin-only" = "full";

  if (options?.campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: options.campaignId },
      select: { channels: true },
    });
    if (campaign) {
      enrichmentProfile = getEnrichmentProfile(getCampaignChannels(campaign));
    }
  }

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
      sourceId: true,
      workspaceSlug: true,
      rawResponse: true,
    },
  });

  // --- Defence-in-depth: strip any placeholder emails before processing ---
  // Placeholder emails (e.g. foo@discovery.internal) are internal sentinel values
  // that should never reach production. This guard protects against stale dist
  // regressions where old compiled code re-introduces placeholder generation.
  for (const record of staged) {
    if (record.email && isPlaceholderEmail(record.email)) {
      console.warn(
        `[promotion] WARNING: placeholder email detected and stripped — "${record.email}" (id: ${record.id}). ` +
        `This should never occur in production. Check for stale dist/ files.`
      );
      record.email = null;
    }
  }

  // --- BL-018: Normalise plural job titles ---
  // Discovery sources sometimes produce plural titles like "Warehouse Managers".
  // Normalise to singular form before promotion to Person table.
  for (const record of staged) {
    if (record.jobTitle) {
      const normalised = normalizeJobTitle(record.jobTitle);
      if (normalised !== record.jobTitle) {
        record.jobTitle = normalised;
      }
    }
  }

  // --- Exclusion list gate (BL-046) ---
  // Remove any DiscoveredPerson whose companyDomain or email domain matches
  // the workspace exclusion list, OR whose exact email matches the email
  // exclusion list. Mark them status='excluded' and skip.
  const exclusionDomains = await getExclusionDomains(workspaceSlug);
  const exclusionEmails = await getExclusionEmails(workspaceSlug);
  let excludedCount = 0;

  if (exclusionDomains.size > 0 || exclusionEmails.size > 0) {
    const excludedIndices = new Set<number>();
    for (let i = 0; i < staged.length; i++) {
      const dp = staged[i];
      let excluded = false;

      // Check companyDomain against domain exclusions
      if (dp.companyDomain) {
        const normalizedCompanyDomain = dp.companyDomain.toLowerCase().replace(/^www\./, "");
        if (exclusionDomains.has(normalizedCompanyDomain)) {
          excluded = true;
        }
      }

      // Check email domain against domain exclusions
      if (!excluded && dp.email) {
        const emailDomain = extractDomain(dp.email);
        if (emailDomain && exclusionDomains.has(emailDomain)) {
          excluded = true;
        }
      }

      // Check exact email against email exclusions
      if (!excluded && dp.email && exclusionEmails.size > 0) {
        if (exclusionEmails.has(dp.email.toLowerCase())) {
          excluded = true;
        }
      }

      if (excluded) {
        excludedIndices.add(i);
      }
    }

    // Batch-update excluded records
    if (excludedIndices.size > 0) {
      const excludedIds = Array.from(excludedIndices).map((i) => staged[i].id);
      await prisma.discoveredPerson.updateMany({
        where: { id: { in: excludedIds } },
        data: { status: "excluded" },
      });

      // Remove excluded records from the staged array (process in reverse to maintain indices)
      const sortedIndices = Array.from(excludedIndices).sort((a, b) => b - a);
      for (const idx of sortedIndices) {
        staged.splice(idx, 1);
      }

      excludedCount = excludedIds.length;
      console.log(
        `[promotion] Excluded ${excludedCount} people matching exclusion list`,
      );
    }
  }

  // --- Pre-fetch domains for ICP scoring (avoids thundering herd on crawl cache) ---
  if (icpScoringEnabled) {
    const domains = staged.map((dp) => dp.companyDomain);
    const prefetchResult = await prefetchDomains(domains);
    console.log(
      `[promotion] Pre-fetched domains for ICP scoring: ${prefetchResult.cached} cached, ${prefetchResult.crawled} crawled, ${prefetchResult.failed} failed`,
    );
  }

  const promotedIds: string[] = [];
  const duplicatePersonIds: string[] = [];
  const duplicateNames: string[] = [];
  let discardedCount = 0;
  let scoredRejectedCount = 0;
  const now = new Date();

  // --- Intra-batch dedup (cross-source within the same discovery run) ---
  // When multiple sources (e.g. Prospeo + AI Ark) return the same person,
  // keep the record with more non-null fields and mark the rest as duplicates.
  const seenEmails = new Map<string, number>(); // email -> index in staged
  const seenLinkedins = new Map<string, number>();
  const skipIndices = new Set<number>();

  for (let i = 0; i < staged.length; i++) {
    const dp = staged[i];
    const email = dp.email ? dp.email.toLowerCase() : null;
    const linkedin = dp.linkedinUrl ?? null;

    // Check email match within batch
    if (email && seenEmails.has(email)) {
      const prevIdx = seenEmails.get(email)!;
      if (!skipIndices.has(prevIdx)) {
        // Keep the record with more data
        if (recordRichnessScore(dp) > recordRichnessScore(staged[prevIdx])) {
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
        if (recordRichnessScore(dp) > recordRichnessScore(staged[prevIdx])) {
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

  // --- Pre-filter: identify non-duplicate, non-discarded candidates for ICP scoring ---
  // First pass: find which records need ICP scoring (non-duplicate, has email or LinkedIn)
  const candidatesForScoring: Array<{ index: number; dp: StagedRecord }> = [];
  const duplicateIndices = new Set<number>();
  const discardedIndices = new Set<number>();

  for (let i = 0; i < staged.length; i++) {
    if (skipIndices.has(i)) continue;
    const dp = staged[i];

    if (!dp.email && !dp.linkedinUrl) {
      discardedIndices.add(i);
      continue;
    }

    const existingPersonId = findExistingPersonFromMaps(dp, dedupMaps);
    if (existingPersonId) {
      duplicateIndices.add(i);
      continue;
    }

    candidatesForScoring.push({ index: i, dp });
  }

  // --- Batch ICP scoring (BL-038 fix: batch instead of sequential) ---
  // Score all non-duplicate candidates in one batch call before the promotion loop.
  // Fail closed: if scoring fails or returns partial results, promotion aborts
  // rather than silently promoting unscored candidates.
  const scoreMap = new Map<string, StagedIcpEvaluationResult>();
  if (icpScoringEnabled && candidatesForScoring.length > 0) {
    try {
      const batchInputs: StagedPersonBatchInput[] = candidatesForScoring.map(({ dp }) => ({
        discoveredPersonId: dp.id,
        firstName: dp.firstName,
        lastName: dp.lastName,
        jobTitle: dp.jobTitle,
        company: dp.company,
        companyDomain: dp.companyDomain,
        location: dp.location,
      }));

      const batchResults = await scoreStagedPersonIcpBatch(batchInputs, workspaceSlug);
      for (const [id, result] of batchResults) {
        scoreMap.set(id, result);
      }
      const missingIds = candidatesForScoring
        .map(({ dp }) => dp.id)
        .filter((id) => !scoreMap.has(id));
      if (missingIds.length > 0) {
        throw new Error(
          `ICP batch scoring returned partial results (${missingIds.length} of ${candidatesForScoring.length} missing)`,
        );
      }
      console.log(
        `[promotion] Batch ICP scored ${scoreMap.size}/${candidatesForScoring.length} candidates`,
      );
    } catch (err) {
      throw new Error(
        `[promotion] Batch ICP scoring failed — refusing to promote unscored candidates: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // --- Main promotion loop ---
  for (let i = 0; i < staged.length; i++) {
    if (skipIndices.has(i)) continue; // already handled as intra-batch dupe
    const dp = staged[i];

    // Discard people with neither email nor LinkedIn URL
    if (discardedIndices.has(i)) {
      await prisma.discoveredPerson.update({
        where: { id: dp.id },
        data: { status: "discarded" },
      });
      discardedCount++;
      continue;
    }

    // Duplicate check (already resolved above)
    if (duplicateIndices.has(i)) {
      const existingPersonId = findExistingPersonFromMaps(dp, dedupMaps)!;
      await ensurePersonWorkspaceLink(existingPersonId, workspaceSlug, dp.sourceId);
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
      continue;
    }

    // --- ICP scoring gate (BL-038) ---
    // Scores were pre-computed in batch above. Look up from scoreMap.
    // Defensive fallback only. The batch scorer above now rejects partial or
    // failed scoring, so under normal conditions every candidate here should
    // already have a score result.
    let promotionScore: PromotionScore | undefined;
    if (icpScoringEnabled) {
      const scoreResult = scoreMap.get(dp.id);
      if (scoreResult) {
        if (scoreResult.status === ICP_NEEDS_WEBSITE_STATUS) {
          await prisma.discoveredPerson.update({
            where: { id: dp.id },
            data: {
              status: "scored_rejected",
              icpScore: null,
              icpReasoning: scoreResult.reasoning,
              icpConfidence: scoreResult.confidence,
            },
          });
          scoredRejectedCount++;
          continue;
        }

        // Persist score on DiscoveredPerson regardless of pass/fail.
        await prisma.discoveredPerson.update({
          where: { id: dp.id },
          data: {
            icpScore: scoreResult.score,
            icpReasoning: scoreResult.reasoning,
            icpConfidence: scoreResult.confidence,
          },
        });

        if (scoreResult.score < icpThreshold) {
          // Below threshold — reject without promotion (saves enrichment credits)
          await prisma.discoveredPerson.update({
            where: { id: dp.id },
            data: { status: "scored_rejected" },
          });
          scoredRejectedCount++;
          continue;
        }

        // Passed the gate — forward the score to promoteToPerson so it lands
        // on PersonWorkspace as well (INV2: keep scores in sync).
        promotionScore = {
          icpScore: scoreResult.score,
          icpReasoning: scoreResult.reasoning,
          icpConfidence: scoreResult.confidence,
          icpScoredAt: now,
        };
      }
      // If scoreResult is undefined, fail-open: promote without score
    }

    // Not a duplicate (and passed ICP gate if enabled) — promote to Person table
    const person = await promoteToPerson(dp, workspaceSlug, promotionScore);

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

  if (discardedCount > 0) {
    console.log(
      `[promotion] Discarded ${discardedCount} people with no valid email`,
    );
  }

  if (scoredRejectedCount > 0) {
    console.log(
      `[promotion] ICP-rejected ${scoredRejectedCount} people below score threshold (${icpThreshold})`,
    );
  }

  // Enqueue enrichment for all newly promoted leads
  const enrichmentJobId = await triggerEnrichmentForPeople(
    promotedIds,
    workspaceSlug,
    enrichmentProfile,
  );

  return {
    promoted: promotedIds.length,
    duplicates: duplicatePersonIds.length,
    discarded: discardedCount,
    scoredRejected: scoredRejectedCount,
    excluded: excludedCount,
    duplicateNames,
    promotedIds,
    enrichmentJobId,
  };
}
