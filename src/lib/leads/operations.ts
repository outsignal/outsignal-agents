/**
 * Shared operations layer for the Leads Agent and future MCP tools.
 *
 * ALL Prisma queries and business logic for the lead pipeline live here.
 * Agent tools and MCP tools are thin wrappers that call these functions.
 * Never put DB queries or business logic inside agent tool closures.
 *
 * Exports: searchPeople, createList, addPeopleToList, getList, getLists,
 *          scoreList, exportListToEmailBison
 */

import { prisma } from "@/lib/db";
import { scorePersonIcp } from "@/lib/icp/scorer";
import { getListExportReadiness } from "@/lib/export/verification-gate";
import { getClientForWorkspace } from "@/lib/workspaces";
import type { TargetList } from "@prisma/client";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PersonSearchResult {
  id: string;
  email: string;
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
}

export interface ExportListResult {
  exported: number;
  alreadyExported: number;
  needsVerification: number;
  blocked: number;
  errors: string[];
}

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
 * @param listId - TargetList ID
 * @param personIds - Array of Person IDs to add
 * @returns { added, alreadyInList }
 */
export async function addPeopleToList(
  listId: string,
  personIds: string[],
): Promise<AddPeopleToListResult> {
  if (personIds.length === 0) {
    return { added: 0, alreadyInList: 0 };
  }

  // Count existing before insert to calculate alreadyInList
  const existingCount = await prisma.targetListPerson.count({
    where: {
      listId,
      personId: { in: personIds },
    },
  });

  const createResult = await prisma.targetListPerson.createMany({
    data: personIds.map((personId) => ({
      listId,
      personId,
    })),
    skipDuplicates: true,
  });

  return {
    added: createResult.count,
    alreadyInList: existingCount,
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
