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

function normalise(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function recordRichnessScore(person: DiscoveredPersonResult): number {
  let score = 0;
  const values = [
    person.email,
    person.firstName,
    person.lastName,
    person.jobTitle,
    person.company,
    person.companyDomain,
    person.linkedinUrl,
    person.phone,
    person.location,
  ];

  for (const value of values) {
    if (!value) continue;
    score += 100;
    score += Math.min(value.trim().length, 40);
  }

  return score;
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

  // Batch-check exact name+domain tuples instead of one query per person.
  const nameDomainTriples = people
    .map((p, i) => ({
      firstName: p.firstName,
      lastName: p.lastName,
      companyDomain: p.companyDomain,
      idx: i,
    }))
    .filter(
      (x): x is { firstName: string; lastName: string; companyDomain: string; idx: number } =>
        Boolean(x.firstName && x.lastName && x.companyDomain),
    );

  if (nameDomainTriples.length > 0) {
    const uniqueTriples = Array.from(
      new Map(
        nameDomainTriples.map((t) => [
          `${normalise(t.firstName)}::${normalise(t.lastName)}::${normalise(t.companyDomain)}`,
          t,
        ]),
      ).values(),
    );

    const existing = await prisma.discoveredPerson.findMany({
      where: {
        workspaceSlug,
        status: { in: ["staged", "promoted"] },
        OR: uniqueTriples.map((t) => ({
          firstName: t.firstName,
          lastName: t.lastName,
          companyDomain: t.companyDomain,
        })),
      },
      select: { firstName: true, lastName: true, companyDomain: true },
    });

    const existingSet = new Set(
      existing.map(
        (r) =>
          `${normalise(r.firstName)}::${normalise(r.lastName)}::${normalise(r.companyDomain)}`,
      ),
    );

    for (const triple of nameDomainTriples) {
      const key = `${normalise(triple.firstName)}::${normalise(triple.lastName)}::${normalise(triple.companyDomain)}`;
      if (existingSet.has(key)) {
        dupeIndices.add(triple.idx);
      }
    }
  }

  // Intra-batch dedup: keep the richer record when the same LinkedIn URL or
  // exact name+domain tuple appears twice in one staging call.
  const bestByLinkedIn = new Map<string, number>();
  const bestByNameDomain = new Map<string, number>();

  for (let i = 0; i < people.length; i++) {
    if (dupeIndices.has(i)) continue;

    const person = people[i];
    const linkedinKey = normalise(person.linkedinUrl);
    const nameDomainKey =
      person.firstName && person.lastName && person.companyDomain
        ? `${normalise(person.firstName)}::${normalise(person.lastName)}::${normalise(person.companyDomain)}`
        : null;

    const candidateKeys = [
      linkedinKey ? { map: bestByLinkedIn, key: linkedinKey } : null,
      nameDomainKey ? { map: bestByNameDomain, key: nameDomainKey } : null,
    ].filter(
      (entry): entry is { map: Map<string, number>; key: string } => entry !== null,
    );

    for (const { map, key } of candidateKeys) {
      const previousIndex = map.get(key);
      if (previousIndex == null || dupeIndices.has(previousIndex)) {
        map.set(key, i);
        continue;
      }

      const keepCurrent =
        recordRichnessScore(person) > recordRichnessScore(people[previousIndex]);
      const duplicateIndex = keepCurrent ? previousIndex : i;
      const winnerIndex = keepCurrent ? i : previousIndex;

      dupeIndices.add(duplicateIndex);
      map.set(key, winnerIndex);
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

      // Build rawResponse JSON from the provider payload only. Source IDs are
      // persisted separately on DiscoveredPerson.sourceId for promotion.
      let rawResponseJson: string | null = null;
      if (hasRawResponses) {
        const baseRaw = input.rawResponses![i];
        const merged: Record<string, unknown> = typeof baseRaw === "object" && baseRaw !== null
          ? { ...baseRaw as Record<string, unknown> }
          : { _rawResponse: baseRaw };
        rawResponseJson = JSON.stringify(merged);
      }

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
        sourceId: person.sourceId ?? null,
        searchQuery: input.searchQuery ?? null,
        workspaceSlug: input.workspaceSlug,
        discoveryRunId: runId,
        rawResponse: rawResponseJson,
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
