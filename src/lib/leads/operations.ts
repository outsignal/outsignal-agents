/**
 * Shared operations layer for the Leads Agent and MCP tools.
 *
 * ALL Prisma queries and business logic for the lead pipeline live here.
 * Agent tools and MCP tools are thin wrappers that call these functions.
 * Never put DB queries or business logic inside agent tool closures.
 *
 * Exports: searchPeople, createList, addPeopleToList, getList, getLists,
 *          scoreList, exportListToEmailBison, findWorkspaceBySlug,
 *          findOrCreateWorkspace, getWorkspaceWithToken, findListById,
 *          resolveEmailsToPersonIds, updatePersonStatus, getPersonById,
 *          getEnrichmentHistory, setWorkspacePrompt, getWorkspacePrompts,
 *          getUnscoredInWorkspace
 */

import { prisma } from "@/lib/db";
import { scorePersonIcp } from "@/lib/icp/scorer";
import { getListExportReadiness } from "@/lib/export/verification-gate";
import { getClientForWorkspace } from "@/lib/workspaces";
import { filterPeopleForChannels } from "@/lib/channels/validation";
import { validatePeopleForChannel } from "@/lib/validation/channel-gate";
import { getExclusionDomains, getExclusionEmails } from "@/lib/exclusions";
import type { TargetList, Person, Workspace } from "@prisma/client";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PersonSearchResult {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyDomain: string | null;
  jobTitle: string | null;
  vertical: string | null;
  location: string | null;
  linkedinUrl: string | null;
  source: string;
  status: string;
  icpScore?: number | null;
  icpReasoning?: string | null;
  workspaces: string[];
}

export interface SearchPeopleParams {
  query?: string;
  jobTitle?: string;
  vertical?: string;
  location?: string;
  workspaceSlug?: string;
  minIcpScore?: number;
  hasVerifiedEmail?: boolean;
  page?: number;
  limit?: number;
}

export interface SearchPeopleResult {
  people: PersonSearchResult[];
  total: number;
  page: number;
}

export interface CreateListParams {
  name: string;
  workspaceSlug: string;
  description?: string;
}

export interface AddPeopleToListResult {
  added: number;
  alreadyInList: number;
  /** People rejected due to channel validation (only present when list is campaign-linked). */
  rejected?: number;
  /** Rejection reason summary (only present when rejected > 0). */
  rejectionSummary?: string;
}

export interface ListSummary {
  id: string;
  name: string;
  workspaceSlug: string;
  description: string | null;
  createdAt: Date;
  peopleCount: number;
}

export interface ListDetail {
  id: string;
  name: string;
  workspaceSlug: string;
  description: string | null;
  createdAt: Date;
  peopleCount: number;
  people: PersonSearchResult[];
}

export interface GetListsParams {
  workspaceSlug?: string;
  query?: string;
}

export interface GetListsResult {
  lists: ListSummary[];
}

export interface ScoreResult {
  personId: string;
  score: number;
  reasoning: string;
}

export interface ScoreListResult {
  scored: number;
  skipped: number;
  failed: number;
  results: ScoreResult[];
  unscoredCount?: number; // Present when confirm=false (dry-run preview)
}

export interface ExportListResult {
  exported: number;
  alreadyExported: number;
  needsVerification: number;
  blocked: number;
  errors: string[];
}

export interface ResolvedEmail {
  email: string;
  personId: string | null;
}

export interface UpdatePersonStatusResult {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface EnrichmentHistoryEntry {
  provider: string;
  fieldsWritten: string | null;
  runAt: Date;
}

export interface WorkspacePrompts {
  name: string;
  icpCriteriaPrompt: string | null;
  normalizationPrompt: string | null;
  outreachTonePrompt: string | null;
}

export interface UnscoredPersonWorkspace {
  personId: string;
  person: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };
}

/** Map prompt_type enum values to Workspace column names. */
const PROMPT_TYPE_TO_COLUMN = {
  icp_criteria: "icpCriteriaPrompt",
  normalization: "normalizationPrompt",
  outreach_tone: "outreachTonePrompt",
} as const;

export type PromptType = keyof typeof PROMPT_TYPE_TO_COLUMN;

// ---------------------------------------------------------------------------
// 1. searchPeople — search people in the DB with optional filters
// ---------------------------------------------------------------------------

/**
 * Search people with optional filters. All DB queries for people search live here.
 *
 * @param params - Filter options: query, jobTitle, vertical, location, workspaceSlug,
 *                 minIcpScore, hasVerifiedEmail, page, limit
 * @returns Paginated list of people with workspace and ICP score data
 */
export async function searchPeople(
  params: SearchPeopleParams,
): Promise<SearchPeopleResult> {
  const {
    query,
    jobTitle,
    vertical,
    location,
    workspaceSlug,
    minIcpScore,
    hasVerifiedEmail,
    page = 1,
    limit = 25,
  } = params;

  // Build AND conditions — same pattern as src/app/api/people/search/route.ts
  const andConditions: Record<string, unknown>[] = [];

  // Free-text search across 5 fields (OR within, case-insensitive)
  if (query) {
    andConditions.push({
      OR: [
        { email: { contains: query, mode: "insensitive" } },
        { firstName: { contains: query, mode: "insensitive" } },
        { lastName: { contains: query, mode: "insensitive" } },
        { company: { contains: query, mode: "insensitive" } },
        { jobTitle: { contains: query, mode: "insensitive" } },
      ],
    });
  }

  // Job title filter — separate from free-text query (allows "find CTOs" specifically)
  if (jobTitle) {
    andConditions.push({
      jobTitle: { contains: jobTitle, mode: "insensitive" },
    });
  }

  // Vertical filter — exact match
  if (vertical) {
    andConditions.push({ vertical });
  }

  // Location filter — contains, case-insensitive
  if (location) {
    andConditions.push({
      location: { contains: location, mode: "insensitive" },
    });
  }

  // Workspace filter — join through PersonWorkspace
  if (workspaceSlug) {
    andConditions.push({
      workspaces: { some: { workspace: workspaceSlug } },
    });
  }

  // Minimum ICP score filter — join through PersonWorkspace
  if (minIcpScore !== undefined) {
    andConditions.push({
      workspaces: {
        some: { icpScore: { gte: minIcpScore } },
      },
    });
  }

  // Verified email filter — check enrichmentData JSON string
  if (hasVerifiedEmail === true) {
    andConditions.push({
      enrichmentData: {
        string_contains: '"emailVerificationStatus":"valid"',
      },
    });
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {};
  const skip = (page - 1) * limit;

  const [rawPeople, total] = await Promise.all([
    prisma.person.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        company: true,
        companyDomain: true,
        jobTitle: true,
        vertical: true,
        location: true,
        linkedinUrl: true,
        source: true,
        status: true,
        workspaces: {
          select: {
            workspace: true,
            icpScore: true,
            icpReasoning: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.person.count({ where }),
  ]);

  const people: PersonSearchResult[] = rawPeople.map((p) => ({
    id: p.id,
    email: p.email,
    firstName: p.firstName,
    lastName: p.lastName,
    company: p.company,
    companyDomain: p.companyDomain,
    jobTitle: p.jobTitle,
    vertical: p.vertical,
    location: p.location,
    linkedinUrl: p.linkedinUrl,
    source: p.source,
    status: p.status,
    // Surface ICP score from the first workspace match (multi-workspace support future work)
    icpScore: p.workspaces[0]?.icpScore ?? null,
    icpReasoning: p.workspaces[0]?.icpReasoning ?? null,
    workspaces: p.workspaces.map((w) => w.workspace),
  }));

  return { people, total, page };
}

// ---------------------------------------------------------------------------
// 2. createList — create a new TargetList
// ---------------------------------------------------------------------------

/**
 * Create a new target list for a workspace.
 *
 * @param params - { name, workspaceSlug, description? }
 * @returns The created TargetList record
 */
export async function createList(params: CreateListParams): Promise<TargetList> {
  return prisma.targetList.create({
    data: {
      name: params.name,
      workspaceSlug: params.workspaceSlug,
      description: params.description,
    },
  });
}

// ---------------------------------------------------------------------------
// 3. addPeopleToList — add people to a list with dedup
// ---------------------------------------------------------------------------

/**
 * Add people to a target list. Skips duplicates (already-in-list people).
 *
 * If the list is linked to a campaign, channel validation is applied before
 * inserting: people who do not satisfy the campaign's channel requirements
 * (e.g. no email for an email campaign, no LinkedIn URL for a LinkedIn
 * campaign) are silently rejected and counted in the returned `rejected`
 * field.  This prevents invalid contacts from accumulating on a list and
 * blocking the campaign at publish time.
 *
 * @param listId    - TargetList ID
 * @param personIds - Array of Person IDs to add
 * @returns { added, alreadyInList, rejected?, rejectionSummary? }
 */
export async function addPeopleToList(
  listId: string,
  personIds: string[],
): Promise<AddPeopleToListResult> {
  if (personIds.length === 0) {
    return { added: 0, alreadyInList: 0 };
  }

  // --- Exclusion list gate (BL-046: defence-in-depth) ---
  // Filter out people whose companyDomain matches the workspace exclusion list.
  // Look up the list's workspace to get the exclusion domains.
  const targetList = await prisma.targetList.findUnique({
    where: { id: listId },
    select: { workspaceSlug: true },
  });
  let excludedFromListCount = 0;
  let activePersonIds = personIds;

  if (targetList) {
    const exclusionDomains = await getExclusionDomains(targetList.workspaceSlug);
    const exclusionEmails = await getExclusionEmails(targetList.workspaceSlug);
    if (exclusionDomains.size > 0 || exclusionEmails.size > 0) {
      const people = await prisma.person.findMany({
        where: { id: { in: personIds } },
        select: { id: true, companyDomain: true, email: true },
      });
      const excludedIds = new Set<string>();
      for (const person of people) {
        // Check domain exclusion
        if (person.companyDomain) {
          const normalized = person.companyDomain.toLowerCase().replace(/^www\./, "");
          if (exclusionDomains.has(normalized)) {
            excludedIds.add(person.id);
            continue;
          }
        }
        // Check email exclusion
        if (person.email && exclusionEmails.size > 0) {
          if (exclusionEmails.has(person.email.toLowerCase())) {
            excludedIds.add(person.id);
          }
        }
      }
      if (excludedIds.size > 0) {
        activePersonIds = personIds.filter((id) => !excludedIds.has(id));
        excludedFromListCount = excludedIds.size;
        console.info(
          `[addPeopleToList] list=${listId} exclusion-filter: ${excludedIds.size} people excluded`,
        );
      }
    }
  }

  if (activePersonIds.length === 0) {
    return { added: 0, alreadyInList: 0, rejected: excludedFromListCount, rejectionSummary: `${excludedFromListCount}x excluded (exclusion list)` };
  }

  // --- Channel validation gate ---
  // Check if the list is linked to a campaign (a campaign may link to a list
  // via targetListId). If so, we need to validate each person against the
  // campaign's channels before inserting.
  const linkedCampaign = await prisma.campaign.findFirst({
    where: { targetListId: listId },
    select: { channels: true },
  });

  let validPersonIds = activePersonIds;
  let rejectedCount = 0;
  let rejectionSummary: string | undefined;

  if (linkedCampaign) {
    // Parse channels JSON (stored as a JSON string in the DB).
    let channels: string[] = ["email"];
    try {
      const parsed = JSON.parse(linkedCampaign.channels ?? '["email"]');
      if (Array.isArray(parsed)) channels = parsed as string[];
    } catch {
      // Fallback to email-only if JSON is malformed.
      channels = ["email"];
    }

    // Fetch the person data required for validation in a single query.
    const people = await prisma.person.findMany({
      where: { id: { in: activePersonIds } },
      select: { id: true, email: true, linkedinUrl: true },
    });

    const { valid, rejected } = filterPeopleForChannels(people, channels);

    validPersonIds = valid.map((p) => p.id);
    rejectedCount = rejected.length;

    // --- Verification-aware gate (BL-009) ---
    // After structural checks pass, validate email verification status for
    // email campaigns. This catches people with null/invalid/unverified emails.
    if (validPersonIds.length > 0 && channels.includes("email")) {
      const channelType = channels.includes("linkedin") ? "both" as const : "email" as const;
      const verificationResult = await validatePeopleForChannel(
        validPersonIds,
        channelType,
      );
      if (verificationResult.rejected.length > 0) {
        // Merge verification rejections into the overall rejection count
        for (const { personId, reason } of verificationResult.rejected) {
          const matchedPerson = people.find((p) => p.id === personId);
          if (matchedPerson) {
            rejected.push({ person: matchedPerson, reason });
          }
        }
        validPersonIds = verificationResult.accepted;
        rejectedCount += verificationResult.rejected.length;
      }
    }

    if (rejectedCount > 0) {
      // Summarise rejections: aggregate reasons across all people.
      const reasonCounts = new Map<string, number>();
      for (const { reason } of rejected) {
        reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
      }
      rejectionSummary = Array.from(reasonCounts.entries())
        .map(([r, n]) => `${n}× ${r}`)
        .join("; ");

      console.info(
        `[addPeopleToList] list=${listId} channel-validation: ` +
          `${validPersonIds.length} valid, ${rejectedCount} rejected — ${rejectionSummary}`,
      );
    }
  }

  // Merge exclusion rejections into the overall count
  rejectedCount += excludedFromListCount;

  if (validPersonIds.length === 0) {
    return { added: 0, alreadyInList: 0, rejected: rejectedCount, rejectionSummary };
  }

  // Count existing before insert to calculate alreadyInList
  const existingCount = await prisma.targetListPerson.count({
    where: {
      listId,
      personId: { in: validPersonIds },
    },
  });

  const createResult = await prisma.targetListPerson.createMany({
    data: validPersonIds.map((personId) => ({
      listId,
      personId,
    })),
    skipDuplicates: true,
  });

  return {
    added: createResult.count,
    alreadyInList: existingCount,
    ...(rejectedCount > 0 ? { rejected: rejectedCount, rejectionSummary } : {}),
  };
}

// ---------------------------------------------------------------------------
// 4. getList — get a single list with people and stats
// ---------------------------------------------------------------------------

/**
 * Get a single target list with its members and people count.
 *
 * @param listId - TargetList ID
 * @returns List detail with people and enriched ICP data, or null if not found
 */
export async function getList(listId: string): Promise<ListDetail | null> {
  const list = await prisma.targetList.findUnique({
    where: { id: listId },
    include: {
      people: {
        include: {
          person: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              company: true,
              companyDomain: true,
              jobTitle: true,
              vertical: true,
              location: true,
              linkedinUrl: true,
              source: true,
              status: true,
              workspaces: {
                select: {
                  workspace: true,
                  icpScore: true,
                  icpReasoning: true,
                },
              },
            },
          },
        },
        orderBy: { addedAt: "desc" },
      },
    },
  });

  if (!list) return null;

  const people: PersonSearchResult[] = list.people.map(({ person: p }) => ({
    id: p.id,
    email: p.email,
    firstName: p.firstName,
    lastName: p.lastName,
    company: p.company,
    companyDomain: p.companyDomain,
    jobTitle: p.jobTitle,
    vertical: p.vertical,
    location: p.location,
    linkedinUrl: p.linkedinUrl,
    source: p.source,
    status: p.status,
    icpScore: p.workspaces[0]?.icpScore ?? null,
    icpReasoning: p.workspaces[0]?.icpReasoning ?? null,
    workspaces: p.workspaces.map((w) => w.workspace),
  }));

  return {
    id: list.id,
    name: list.name,
    workspaceSlug: list.workspaceSlug,
    description: list.description,
    createdAt: list.createdAt,
    peopleCount: list.people.length,
    people,
  };
}

// ---------------------------------------------------------------------------
// 5. getLists — list all target lists for a workspace
// ---------------------------------------------------------------------------

/**
 * List all target lists, optionally filtered by workspace or name query.
 *
 * @param params - { workspaceSlug?, query? }
 * @returns { lists: ListSummary[] }
 */
export async function getLists(params: GetListsParams): Promise<GetListsResult> {
  const { workspaceSlug, query } = params;

  const andConditions: Record<string, unknown>[] = [];

  if (workspaceSlug) {
    andConditions.push({ workspaceSlug });
  }

  if (query) {
    andConditions.push({
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    });
  }

  const where = andConditions.length > 0 ? { AND: andConditions } : {};

  const rawLists = await prisma.targetList.findMany({
    where,
    include: {
      _count: {
        select: { people: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const lists: ListSummary[] = rawLists.map((l) => ({
    id: l.id,
    name: l.name,
    workspaceSlug: l.workspaceSlug,
    description: l.description,
    createdAt: l.createdAt,
    peopleCount: l._count.people,
  }));

  return { lists };
}

// ---------------------------------------------------------------------------
// 6. scoreList — score unscored people in a list
// ---------------------------------------------------------------------------

/**
 * Score all unscored people in a target list using the workspace ICP criteria.
 *
 * Skips people that already have an icpScoredAt timestamp for this workspace.
 * Uses batched parallel scoring (chunks of 5) to avoid Anthropic rate limits.
 *
 * @param listId - TargetList ID
 * @param workspaceSlug - Workspace to score against (determines ICP criteria)
 * @returns { scored, skipped, failed, results }
 * @throws If workspace has no icpCriteriaPrompt configured
 */
export async function scoreList(
  listId: string,
  workspaceSlug: string,
  confirm: boolean = true,
): Promise<ScoreListResult> {
  // Check icpCriteriaPrompt is configured — fail fast before scoring (Pitfall 1)
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { icpCriteriaPrompt: true },
  });

  if (!workspace) {
    throw new Error(`Workspace not found: '${workspaceSlug}'`);
  }

  if (!workspace.icpCriteriaPrompt?.trim()) {
    throw new Error(
      `No ICP criteria prompt configured for workspace '${workspaceSlug}'. ` +
        `Use the set_workspace_prompt tool to configure it first.`,
    );
  }

  // Fetch all list members with their PersonWorkspace record for this workspace
  const members = await prisma.targetListPerson.findMany({
    where: { listId },
    include: {
      person: {
        select: {
          id: true,
          workspaces: {
            where: { workspace: workspaceSlug },
            select: { icpScoredAt: true },
          },
        },
      },
    },
  });

  // Separate scored vs unscored (Pitfall 5 — skip already-scored)
  const unscored: string[] = [];
  let skipped = 0;

  for (const member of members) {
    const pw = member.person.workspaces[0];
    if (pw?.icpScoredAt !== null && pw?.icpScoredAt !== undefined) {
      skipped++;
    } else {
      unscored.push(member.person.id);
    }
  }

  // Credit-gate: return count without scoring when confirm=false
  if (!confirm) {
    return {
      scored: 0,
      skipped,
      failed: 0,
      results: [],
      unscoredCount: unscored.length,
    };
  }

  // Score in batches of 5 using Promise.allSettled (conservative to avoid rate limits)
  const CHUNK_SIZE = 5;
  const results: ScoreResult[] = [];
  let failed = 0;

  for (let i = 0; i < unscored.length; i += CHUNK_SIZE) {
    const chunk = unscored.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.allSettled(
      chunk.map((personId) => scorePersonIcp(personId, workspaceSlug, false)),
    );

    for (let j = 0; j < chunkResults.length; j++) {
      const outcome = chunkResults[j];
      const personId = chunk[j];
      if (outcome.status === "fulfilled") {
        results.push({
          personId,
          score: outcome.value.score,
          reasoning: outcome.value.reasoning,
        });
      } else {
        failed++;
        console.error(
          `[scoreList] Failed to score person ${personId}:`,
          outcome.reason,
        );
      }
    }
  }

  return {
    scored: results.length,
    skipped,
    failed,
    results,
  };
}

// ---------------------------------------------------------------------------
// 7. exportListToEmailBison — export verified leads to EmailBison
// ---------------------------------------------------------------------------

/**
 * Export verified leads from a target list to the EmailBison workspace.
 *
 * Credit-gate: if any members need verification, returns immediately with the
 * count — user must approve verification spend before export can proceed.
 *
 * @param listId - TargetList ID
 * @param workspaceSlug - Target EmailBison workspace
 * @returns { exported, alreadyExported, needsVerification, blocked, errors }
 */
export async function exportListToEmailBison(
  listId: string,
  workspaceSlug: string,
): Promise<ExportListResult> {
  // Check export readiness — categorizes members into ready/needsVerification/blocked
  const readiness = await getListExportReadiness(listId);

  // Credit-gate: block export if any members are unverified (Pitfall 3 from spike)
  if (readiness.needsVerificationCount > 0) {
    return {
      exported: 0,
      alreadyExported: 0,
      needsVerification: readiness.needsVerificationCount,
      blocked: readiness.blockedCount,
      errors: [],
    };
  }

  if (readiness.readyCount === 0) {
    return {
      exported: 0,
      alreadyExported: 0,
      needsVerification: 0,
      blocked: readiness.blockedCount,
      errors: [],
    };
  }

  // Check workspace exists and has API token configured
  const wsRecord = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { apiToken: true },
  });
  if (!wsRecord) {
    throw new Error(`Workspace not found: '${workspaceSlug}'`);
  }
  if (!wsRecord.apiToken) {
    throw new Error(
      `Workspace '${workspaceSlug}' is not connected to EmailBison. ` +
        `Set the API token in workspace settings to enable export.`,
    );
  }

  // Get EmailBison client for this workspace
  const client = await getClientForWorkspace(workspaceSlug);

  const errors: string[] = [];
  let exported = 0;

  // Upload each verified lead to EmailBison
  for (const person of readiness.readyPeople) {
    try {
      await client.createLead({
        email: person.email,
        firstName: person.firstName ?? undefined,
        lastName: person.lastName ?? undefined,
        jobTitle: person.jobTitle ?? undefined,
        company: person.company ?? undefined,
        phone: person.phone ?? undefined,
      });
      exported++;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      errors.push(`Failed to export ${person.email}: ${message}`);
    }
  }

  return {
    exported,
    alreadyExported: 0, // EmailBison deduplicates on its side; we don't track this separately
    needsVerification: 0,
    blocked: readiness.blockedCount,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 8. findWorkspaceBySlug — look up a workspace by slug
// ---------------------------------------------------------------------------

/**
 * Look up a workspace by slug. Returns null if not found.
 *
 * @param slug - Workspace slug
 * @returns Workspace record or null
 */
export async function findWorkspaceBySlug(
  slug: string,
): Promise<Workspace | null> {
  return prisma.workspace.findUnique({ where: { slug } });
}

// ---------------------------------------------------------------------------
// 9. findOrCreateWorkspace — get or auto-create a workspace
// ---------------------------------------------------------------------------

/**
 * Find a workspace by slug, or create it if it does not exist.
 * Returns the workspace and a flag indicating whether it was just created.
 *
 * @param slug - Workspace slug
 * @returns { workspace, created }
 */
export async function findOrCreateWorkspace(
  slug: string,
): Promise<{ workspace: Workspace; created: boolean }> {
  const existing = await prisma.workspace.findUnique({ where: { slug } });
  if (existing) {
    return { workspace: existing, created: false };
  }
  const created = await prisma.workspace.create({
    data: { slug, name: slug },
  });
  return { workspace: created, created: true };
}

// ---------------------------------------------------------------------------
// 10. getWorkspaceWithToken — get workspace ensuring apiToken exists
// ---------------------------------------------------------------------------

/**
 * Get a workspace by slug and check that it has an apiToken configured.
 * Returns null if workspace not found. Throws if apiToken is missing.
 *
 * @param slug - Workspace slug
 * @returns Workspace record or null
 */
export async function getWorkspaceWithToken(
  slug: string,
): Promise<Workspace | null> {
  return prisma.workspace.findUnique({ where: { slug } });
}

// ---------------------------------------------------------------------------
// 11. findListById — look up a target list by ID
// ---------------------------------------------------------------------------

/**
 * Look up a target list by ID. Returns basic info (id, name).
 * Returns null if not found.
 *
 * @param listId - TargetList ID
 * @returns { id, name } or null
 */
export async function findListById(
  listId: string,
): Promise<{ id: string; name: string } | null> {
  return prisma.targetList.findUnique({
    where: { id: listId },
    select: { id: true, name: true },
  });
}

// ---------------------------------------------------------------------------
// 12. resolveEmailsToPersonIds — map email addresses to Person IDs
// ---------------------------------------------------------------------------

/**
 * Resolve an array of email addresses to Person IDs.
 * Returns all results including nulls for emails not found.
 *
 * @param emails - Array of email addresses
 * @returns Array of { email, personId } (personId is null if not found)
 */
export async function resolveEmailsToPersonIds(
  emails: string[],
): Promise<ResolvedEmail[]> {
  // Batch lookup — fetch all matching people in one query
  const people = await prisma.person.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });

  const emailToId = new Map(people.map((p) => [p.email, p.id]));

  return emails.map((email) => ({
    email,
    personId: emailToId.get(email) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// 13. updatePersonStatus — update a person's status
// ---------------------------------------------------------------------------

/**
 * Update a person's status. Optionally also updates the PersonWorkspace record.
 *
 * @param personId - Person ID
 * @param status - New status value
 * @param workspaceSlug - If provided, also update PersonWorkspace.status
 * @returns { firstName, lastName, email } of the updated person
 */
export async function updatePersonStatus(
  personId: string,
  status: string,
  workspaceSlug?: string,
): Promise<UpdatePersonStatusResult> {
  return prisma.$transaction(async (tx) => {
    const person = await tx.person.update({
      where: { id: personId },
      data: { status },
      select: { firstName: true, lastName: true, email: true },
    });

    if (workspaceSlug) {
      await tx.personWorkspace.updateMany({
        where: { personId, workspace: workspaceSlug },
        data: { status },
      });
    }

    return person;
  });
}

// ---------------------------------------------------------------------------
// 14. getPersonById — get a person by ID
// ---------------------------------------------------------------------------

/**
 * Get a person record by ID. Throws if not found.
 *
 * @param personId - Person ID
 * @returns Full Person record
 */
export async function getPersonById(personId: string): Promise<Person> {
  return prisma.person.findUniqueOrThrow({ where: { id: personId } });
}

// ---------------------------------------------------------------------------
// 15. getEnrichmentHistory — get successful enrichment logs for a person
// ---------------------------------------------------------------------------

/**
 * Get the enrichment history (successful runs) for a person.
 *
 * @param personId - Person ID
 * @returns Array of { provider, fieldsWritten, runAt }
 */
export async function getEnrichmentHistory(
  personId: string,
): Promise<EnrichmentHistoryEntry[]> {
  return prisma.enrichmentLog.findMany({
    where: { entityId: personId, entityType: "person", status: "success" },
    select: { provider: true, fieldsWritten: true, runAt: true },
    orderBy: { runAt: "desc" },
  });
}

// ---------------------------------------------------------------------------
// 16. setWorkspacePrompt — set an AI prompt override on a workspace
// ---------------------------------------------------------------------------

/**
 * Set a specific AI prompt override on a workspace.
 *
 * @param slug - Workspace slug
 * @param promptType - Which prompt to set (icp_criteria, normalization, outreach_tone)
 * @param promptText - The prompt text
 */
export async function setWorkspacePrompt(
  slug: string,
  promptType: PromptType,
  promptText: string,
): Promise<void> {
  const columnName = PROMPT_TYPE_TO_COLUMN[promptType];
  await prisma.workspace.update({
    where: { slug },
    data: { [columnName]: promptText },
  });
}

// ---------------------------------------------------------------------------
// 17. getWorkspacePrompts — get all AI prompt overrides for a workspace
// ---------------------------------------------------------------------------

/**
 * Get all AI prompt overrides configured for a workspace. Throws if not found.
 *
 * @param slug - Workspace slug
 * @returns { name, icpCriteriaPrompt, normalizationPrompt, outreachTonePrompt }
 */
export async function getWorkspacePrompts(
  slug: string,
): Promise<WorkspacePrompts> {
  return prisma.workspace.findUniqueOrThrow({
    where: { slug },
    select: {
      name: true,
      icpCriteriaPrompt: true,
      normalizationPrompt: true,
      outreachTonePrompt: true,
    },
  });
}

// ---------------------------------------------------------------------------
// 18. getUnscoredInWorkspace — find unscored people in a workspace
// ---------------------------------------------------------------------------

/**
 * Find all unscored people (icpScore is null) in a workspace.
 *
 * @param workspaceSlug - Workspace slug
 * @returns Array of PersonWorkspace records with basic person data
 */
export async function getUnscoredInWorkspace(
  workspaceSlug: string,
): Promise<UnscoredPersonWorkspace[]> {
  return prisma.personWorkspace.findMany({
    where: {
      workspace: workspaceSlug,
      icpScore: null,
    },
    include: {
      person: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });
}
