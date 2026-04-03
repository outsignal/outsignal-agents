/**
 * Apollo People Search discovery adapter.
 *
 * Uses the Apollo People API to search 275M+ contacts by title, seniority,
 * location, company size, and more. Apollo search is free — no credits consumed.
 *
 * Endpoint: POST https://api.apollo.io/api/v1/mixed_people/api_search
 * Auth: x-api-key header
 * Docs: https://docs.apollo.io/reference/people-api
 *
 * NOTE: Apollo search does NOT return email addresses.
 * Email enrichment is Phase 17's responsibility (via Prospeo /enrich-person).
 */
import { z } from "zod";
import type {
  DiscoveryAdapter,
  DiscoveryFilter,
  DiscoveredPersonResult,
  DiscoveryResult,
} from "../types";
import { stripWwwAll, type RateLimits } from "../rate-limit";

const APOLLO_ENDPOINT =
  "https://api.apollo.io/api/v1/mixed_people/api_search";
const TIMEOUT_MS = 15_000;

/** Apollo adapter rate limits */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 25,
  delayBetweenCalls: 200,
  maxConcurrent: 1,
  dailyCap: null,
};

function getApiKey(): string {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error("APOLLO_API_KEY environment variable is not set");
  return key;
}

// ---------------------------------------------------------------------------
// Response schema (passthrough to preserve extra fields in rawResponse)
// ---------------------------------------------------------------------------

const ApolloPersonSchema = z
  .object({
    id: z.string(),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    linkedin_url: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    organization_name: z.string().optional().nullable(),
    organization: z
      .object({
        primary_domain: z.string().optional().nullable(),
        estimated_num_employees: z.number().optional().nullable(),
        industry: z.string().optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .passthrough();

const ApolloResponseSchema = z
  .object({
    people: z.array(ApolloPersonSchema).optional().default([]),
    pagination: z
      .object({
        total_entries: z.number().optional().nullable(),
        page: z.number().optional().nullable(),
        per_page: z.number().optional().nullable(),
      })
      .optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a DiscoveryFilter company size range to Apollo's comma-separated format.
 * Apollo expects: "51,200" for "51-200", "500,100000" for "500+"
 */
export function sizeToApolloRange(size: string): string {
  if (size.endsWith("+")) {
    const min = size.slice(0, -1);
    return `${min},100000`;
  }
  return size.replace("-", ",");
}

/**
 * Map DiscoveryFilter seniority values to Apollo's seniority param values.
 * Apollo uses underscore format: c_suite, vp, director, manager, senior (for IC).
 */
function mapSeniority(seniority: string): string {
  const map: Record<string, string> = {
    c_suite: "c_suite",
    vp: "vp",
    director: "director",
    manager: "manager",
    ic: "senior",
  };
  return map[seniority] ?? seniority;
}

// ---------------------------------------------------------------------------
// ApolloAdapter
// ---------------------------------------------------------------------------

export class ApolloAdapter implements DiscoveryAdapter {
  readonly name = "apollo";

  /**
   * Apollo search is free — no credits consumed per result.
   */
  readonly estimatedCostPerResult = 0;

  async search(
    filters: DiscoveryFilter,
    limit: number,
    pageToken?: string
  ): Promise<DiscoveryResult> {
    const apiKey = getApiKey();
    const page = pageToken ? parseInt(pageToken, 10) : 1;
    const perPage = Math.min(limit, 100);

    // Build Apollo request body from DiscoveryFilter
    const body: Record<string, unknown> = {
      page,
      per_page: perPage,
    };

    if (filters.jobTitles?.length) {
      body.person_titles = filters.jobTitles;
    }

    if (filters.seniority?.length) {
      body.person_seniorities = filters.seniority.map(mapSeniority);
    }

    if (filters.locations?.length) {
      body.person_locations = filters.locations;
    }

    if (filters.companySizes?.length) {
      body.organization_num_employees_ranges = filters.companySizes.map(
        sizeToApolloRange
      );
    }

    if (filters.industries?.length) {
      // Apollo industry IDs are unreliable — use keyword tag search as fallback
      body.q_organization_keyword_tags = filters.industries;
    }

    if (filters.keywords?.length) {
      body.q_keywords = filters.keywords.join(" ");
    }

    if (filters.companyDomains?.length) {
      // Strip www. prefixes before sending to API
      body.organization_domains = stripWwwAll(filters.companyDomains);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let raw: unknown;
    try {
      const res = await fetch(APOLLO_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 429) {
          const err = new Error("Apollo rate-limited: HTTP 429");
          (err as any).status = 429;
          throw err;
        }
        throw new Error(
          `Apollo API error: ${res.status} ${res.statusText}`
        );
      }

      raw = await res.json();
    } finally {
      clearTimeout(timeout);
    }

    const parsed = ApolloResponseSchema.safeParse(raw);

    if (!parsed.success) {
      console.warn(
        "[ApolloAdapter] Zod validation failed:",
        parsed.error.message
      );
      return { people: [], costUsd: 0, rawResponse: raw };
    }

    const data = parsed.data;
    const totalEntries = data.pagination?.total_entries ?? 0;

    // Map Apollo person records to DiscoveredPersonResult
    const people: DiscoveredPersonResult[] = (data.people ?? []).map(
      (person) => {
        const locationParts = [person.city, person.country].filter(Boolean);
        return {
          firstName: person.first_name ?? undefined,
          lastName: person.last_name ?? undefined,
          jobTitle: person.title ?? undefined,
          linkedinUrl: person.linkedin_url ?? undefined,
          company: person.organization_name ?? undefined,
          companyDomain: person.organization?.primary_domain ?? undefined,
          location:
            locationParts.length > 0 ? locationParts.join(", ") : undefined,
          sourceId: person.id,
          // email is always undefined — Apollo search does not return emails
        };
      }
    );

    const hasMore = page * perPage < totalEntries;
    const nextPageToken = hasMore ? String(page + 1) : undefined;

    // Enrichment is decoupled — discovery returns identity data only.
    // Enrichment happens asynchronously via the EnrichmentJob queue after promotion.

    return {
      people,
      totalAvailable: totalEntries,
      hasMore,
      nextPageToken,
      costUsd: 0, // Apollo search is free, enrichment happens later via EnrichmentJob
      rawResponse: raw,
    };
  }
}

/** Singleton instance for use in agent tools */
export const apolloAdapter = new ApolloAdapter();
