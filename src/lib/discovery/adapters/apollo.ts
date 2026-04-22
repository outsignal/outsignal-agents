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
import { APOLLO_DISABLED_MESSAGE } from "@/lib/discovery/apollo-disabled";
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

/** Apollo adapter rate limits
 * Source: Apollo API /usage_stats endpoint — free plan limits
 */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 25,
  delayBetweenCalls: 1200,
  maxConcurrent: 1,
  minuteCap: 50,
  hourlyCap: 200,
  dailyCap: 600,
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
    _filters: DiscoveryFilter,
    _limit: number,
    _pageToken?: string
  ): Promise<DiscoveryResult> {
    throw new Error(APOLLO_DISABLED_MESSAGE);
  }
}

/** Singleton instance for use in agent tools */
export const apolloAdapter = new ApolloAdapter();
