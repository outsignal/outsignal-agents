/**
 * Staging helper — shared write path for all discovery adapters.
 *
 * All adapters produce DiscoveredPersonResult arrays. This module writes them
 * to the DiscoveredPerson table in batches, grouping records by a run ID for
 * later dedup and promotion (Phase 17).
 *
 * Dedup at staging: Before writing, checks for existing records with the same
 * linkedinUrl or firstName+lastName+companyDomain for this workspace. Skips
 * duplicates to prevent accumulation.
 */
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import type { DiscoveredPersonResult } from "./types";

export interface StagingInput {
  /** Array of discovered people from a discovery adapter */
  people: DiscoveredPersonResult[];

  /** Discovery source identifier: "apollo" | "prospeo" | "serper" | "serper-maps" | "firecrawl" | "aiark" */
  discoverySource: string;

  /** Which workspace this discovery run belongs to */
  workspaceSlug: string;

  /** JSON-serialized filters or query text used to find these people */
  searchQuery?: string;

  /** Groups records from the same batch; auto-generated UUID if omitted */
  discoveryRunId?: string;

  /**
   * Per-person raw API response objects (parallel array to people).
   * If provided and same length as people, each is JSON-stringified into rawResponse.
   * If omitted or length mismatch, rawResponse is left null.
   */
  rawResponses?: unknown[];
}

export interface StagingResult {
  /** Number of records written to the database */
  staged: number;

  /** Number of duplicates skipped at staging */
  duplicatesSkipped: number;

  /** The run ID used to group this batch (auto-generated if not provided in input) */
  runId: string;
}

/**
 * Check if a DiscoveredPerson already exists for this workspace by
 * linkedinUrl or firstName+lastName+companyDomain.
 */
async function findExistingDuplicates(
  workspaceSlug: string,
  people: DiscoveredPersonResult[],
): Promise<Set<number>> {
  const dupeIndices = new Set<number>();

  // Collect LinkedIn URLs to check
  const linkedinUrls = people
    .map((p, i) => ({ url: p.linkedinUrl, idx: i }))
    .filter((x) => !!x.url);

  if (linkedinUrls.length > 0) {
    const existing = await prisma.discoveredPerson.findMany({
      where: {
        workspaceSlug,
        linkedinUrl: { in: linkedinUrls.map((x) => x.url!) },
        status: { in: ["staged", "promoted"] },
      },
      select: { linkedinUrl: true },
    });

    const existingSet = new Set(existing.map((r) => r.linkedinUrl?.toLowerCase()));

    for (const { url, idx } of linkedinUrls) {
      if (url && existingSet.has(url.toLowerCase())) {
        dupeIndices.add(idx);
      }
    }
  }

  // For people without LinkedIn URLs (or not yet caught), check name+domain
  for (let i = 0; i < people.length; i++) {
    if (dupeIndices.has(i)) continue;

    const p = people[i];
    if (p.firstName && p.lastName && p.companyDomain) {
      const match = await prisma.discoveredPerson.findFirst({
        where: {
          workspaceSlug,
          firstName: p.firstName,
          lastName: p.lastName,
          companyDomain: p.companyDomain,
          status: { in: ["staged", "promoted"] },
        },
        select: { id: true },
      });

      if (match) {
        dupeIndices.add(i);
      }
    }
  }

  return dupeIndices;
}

/**
 * Write a batch of DiscoveredPersonResult records to the DiscoveredPerson table.
 *
 * Deduplicates at staging: skips records that already exist in the workspace
 * (by linkedinUrl or firstName+lastName+companyDomain).
 *
 * @param input - StagingInput with people array and provenance metadata
 * @returns Number of records staged, duplicates skipped, and the run ID
 */
export async function stageDiscoveredPeople(
  input: StagingInput
): Promise<StagingResult> {
  const runId = input.discoveryRunId ?? randomUUID();

  if (input.people.length === 0) {
    return { staged: 0, duplicatesSkipped: 0, runId };
  }

  // Find duplicates before staging
  const dupeIndices = await findExistingDuplicates(
    input.workspaceSlug,
    input.people,
  );

  const hasRawResponses =
    input.rawResponses !== undefined &&
    input.rawResponses.length === input.people.length;

  // Filter out duplicates
  const records = input.people
    .map((person, i) => {
      if (dupeIndices.has(i)) return null;
      return {
        email: person.email ?? null,
        firstName: person.firstName ?? null,
        lastName: person.lastName ?? null,
        jobTitle: person.jobTitle ?? null,
        company: person.company ?? null,
        companyDomain: person.companyDomain ?? null,
        linkedinUrl: person.linkedinUrl ?? null,
        phone: person.phone ?? null,
        location: person.location ?? null,
        discoverySource: input.discoverySource,
        searchQuery: input.searchQuery ?? null,
        workspaceSlug: input.workspaceSlug,
        discoveryRunId: runId,
        rawResponse: hasRawResponses
          ? JSON.stringify(input.rawResponses![i])
          : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (dupeIndices.size > 0) {
    console.log(
      `[staging] Dedup: ${dupeIndices.size} duplicates skipped, ${records.length} records to stage for workspace ${input.workspaceSlug}`,
    );
  }

  if (records.length === 0) {
    return { staged: 0, duplicatesSkipped: dupeIndices.size, runId };
  }

  const result = await prisma.discoveredPerson.createMany({
    data: records,
    skipDuplicates: false,
  });

  return { staged: result.count, duplicatesSkipped: dupeIndices.size, runId };
}
