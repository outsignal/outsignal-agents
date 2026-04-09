/**
 * Prospeo email-finding adapter.
 * Finds a person's email given their LinkedIn URL, or falls back to name+company lookup.
 *
 * Endpoint: POST https://api.prospeo.io/enrich-person
 * Auth: X-KEY header
 * Docs: https://prospeo.io/api
 *
 * NOTE: /social-url-finder was removed March 2026 — use /enrich-person exclusively.
 */
import { z } from "zod";
import { CreditExhaustionError } from "@/lib/enrichment/credit-exhaustion";
import { PROVIDER_COSTS } from "../costs";
import type { EmailAdapter, EmailProviderResult } from "../types";
import type { RateLimits } from "@/lib/discovery/rate-limit";

/**
 * Prospeo enrich endpoint rate limits.
 * Source: Prospeo API docs.
 *
 * Enrich endpoints (/enrich-person):
 *   - 5 requests/second
 *   - 300 requests/minute
 *   - 2,000 requests/day
 * Returns 429 when exceeded.
 * Response headers: x-daily-request-left, x-minute-request-left, x-second-rate-limit
 */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 1,
  delayBetweenCalls: 200,        // 5 req/s — Source: Prospeo API docs
  maxConcurrent: 1,
  dailyCap: 2000,                // 2,000 requests/day — Source: Prospeo API docs
  cooldownOnRateLimit: 60_000,   // 60s wait after 429
};

const PROSPEO_ENDPOINT = "https://api.prospeo.io/enrich-person";
const TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.PROSPEO_API_KEY;
  if (!key) throw new Error("PROSPEO_API_KEY environment variable is not set");
  return key;
}

const ProspeoResponseSchema = z.object({
  error: z.boolean(),
  person: z
    .object({
      email: z
        .object({
          email: z.string().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
});

/**
 * Prospeo adapter — finds email via LinkedIn URL or name+company fallback.
 * Returns null email (costUsd=0) when insufficient input provided.
 */
// ---------------------------------------------------------------------------
// Bulk enrichment
// ---------------------------------------------------------------------------

const PROSPEO_BULK_ENDPOINT = "https://api.prospeo.io/bulk-enrich-person";
const BULK_BATCH_SIZE = 50;

const ProspeosBulkResponseSchema = z.object({
  error: z.boolean(),
  total_cost: z.number().optional(),
  matched: z.array(
    z.object({
      identifier: z.string(),
      person: z
        .object({
          email: z
            .object({
              email: z.string().nullable().optional(),
            })
            .optional(),
        })
        .passthrough()
        .optional(),
      company: z.object({}).passthrough().optional(),
    }).passthrough(),
  ).optional(),
  not_matched: z.array(z.string()).optional(),
  invalid_datapoints: z.array(z.string()).optional(),
}).passthrough();

export interface BulkEnrichPersonInput {
  personId: string;
  firstName?: string;
  lastName?: string;
  linkedinUrl?: string;
  companyDomain?: string;
}

/**
 * Bulk enrich people via Prospeo.
 * Accepts up to any number of people — automatically chunks into batches of 50.
 * Returns a Map of personId → EmailProviderResult.
 */
export async function bulkEnrichPerson(
  people: BulkEnrichPersonInput[],
): Promise<Map<string, EmailProviderResult>> {
  const results = new Map<string, EmailProviderResult>();
  const apiKey = getApiKey();

  // Chunk into batches of 50
  for (let i = 0; i < people.length; i += BULK_BATCH_SIZE) {
    const batch = people.slice(i, i + BULK_BATCH_SIZE);

    // Build request data — filter to people with sufficient input
    const dataPoints: Array<{
      identifier: string;
      first_name?: string;
      last_name?: string;
      linkedin_url?: string;
      company_website?: string;
    }> = [];

    for (const person of batch) {
      const hasLinkedin = Boolean(person.linkedinUrl);
      const hasNameAndCompany =
        Boolean(person.firstName) &&
        Boolean(person.lastName) &&
        Boolean(person.companyDomain);

      if (!hasLinkedin && !hasNameAndCompany) {
        // Insufficient input — skip with zero cost
        results.set(person.personId, {
          email: null,
          source: "prospeo",
          rawResponse: { skipped: "insufficient input" },
          costUsd: 0,
        });
        continue;
      }

      const dp: {
        identifier: string;
        first_name?: string;
        last_name?: string;
        linkedin_url?: string;
        company_website?: string;
      } = { identifier: person.personId };
      if (person.firstName) dp.first_name = person.firstName;
      if (person.lastName) dp.last_name = person.lastName;
      if (person.linkedinUrl) dp.linkedin_url = person.linkedinUrl;
      if (person.companyDomain) dp.company_website = person.companyDomain;
      dataPoints.push(dp);
    }

    if (dataPoints.length === 0) continue;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000); // longer timeout for bulk

    try {
      const res = await fetch(PROSPEO_BULK_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-KEY": apiKey,
        },
        body: JSON.stringify({
          only_verified_email: false,
          data: dataPoints,
        }),
        signal: controller.signal,
      });

      if (res.status === 402 || res.status === 403) {
        throw new CreditExhaustionError("prospeo", res.status);
      }

      if (res.status === 429) {
        const err = new Error("Prospeo bulk rate-limited: HTTP 429");
        (err as any).status = 429;
        throw err;
      }

      if (!res.ok) {
        throw new Error(`Prospeo bulk HTTP error: ${res.status} ${res.statusText}`);
      }

      const raw = await res.json();
      const parsed = ProspeosBulkResponseSchema.safeParse(raw);

      if (!parsed.success) {
        console.warn("[prospeo-bulk] Zod validation failed:", parsed.error.message, "rawResponse:", raw);
        // Mark all in this batch as failed with cost
        for (const dp of dataPoints) {
          results.set(dp.identifier, {
            email: null,
            source: "prospeo",
            rawResponse: raw,
            costUsd: PROVIDER_COSTS.prospeo,
          });
        }
        continue;
      }

      // Process matched results
      const matchedIds = new Set<string>();
      if (parsed.data.matched) {
        for (const match of parsed.data.matched) {
          matchedIds.add(match.identifier);
          const email = match.person?.email?.email ?? null;
          results.set(match.identifier, {
            email,
            source: "prospeo",
            rawResponse: match,
            costUsd: PROVIDER_COSTS.prospeo,
          });
        }
      }

      // Process not_matched
      if (parsed.data.not_matched) {
        for (const id of parsed.data.not_matched) {
          if (!matchedIds.has(id)) {
            results.set(id, {
              email: null,
              source: "prospeo",
              rawResponse: { not_matched: true },
              costUsd: PROVIDER_COSTS.prospeo,
            });
          }
        }
      }

      // Process invalid_datapoints
      if (parsed.data.invalid_datapoints) {
        for (const id of parsed.data.invalid_datapoints) {
          if (!matchedIds.has(id)) {
            results.set(id, {
              email: null,
              source: "prospeo",
              rawResponse: { invalid_datapoint: true },
              costUsd: 0, // invalid datapoints don't cost credits
            });
          }
        }
      }

      // Any remaining people in the batch that weren't in any response category
      for (const dp of dataPoints) {
        if (!results.has(dp.identifier)) {
          results.set(dp.identifier, {
            email: null,
            source: "prospeo",
            rawResponse: { missing_from_response: true },
            costUsd: PROVIDER_COSTS.prospeo,
          });
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Single enrichment (existing)
// ---------------------------------------------------------------------------

/**
 * Prospeo adapter — finds email via LinkedIn URL or name+company fallback.
 * Returns null email (costUsd=0) when insufficient input provided.
 */
export const prospeoAdapter: EmailAdapter = async (
  input
): Promise<EmailProviderResult> => {
  const hasLinkedin = Boolean(input.linkedinUrl);
  const hasNameAndCompany =
    Boolean(input.firstName) &&
    Boolean(input.lastName) &&
    Boolean(input.companyName ?? input.companyDomain);

  // Early return if we can't form a valid request
  if (!hasLinkedin && !hasNameAndCompany) {
    return {
      email: null,
      source: "prospeo",
      rawResponse: { skipped: "insufficient input" },
      costUsd: 0,
    };
  }

  const apiKey = getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let raw: unknown;
  try {
    const body = hasLinkedin
      ? { data: { linkedin_url: input.linkedinUrl } }
      : {
          data: {
            first_name: input.firstName,
            last_name: input.lastName,
            company_name: input.companyName,
            company_website: input.companyDomain,
          },
        };

    const res = await fetch(PROSPEO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-KEY": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 402 || res.status === 403) {
      throw new CreditExhaustionError("prospeo", res.status);
    }

    if (!res.ok) {
      if (res.status === 429) {
        const err = new Error(`Prospeo rate-limited: HTTP 429`);
        (err as any).status = 429;
        throw err;
      }
      if (res.status === 404 || res.status === 422) {
        const err = new Error(`Prospeo returned HTTP ${res.status}`);
        (err as any).status = res.status;
        throw err;
      }
      throw new Error(`Prospeo HTTP error: ${res.status} ${res.statusText}`);
    }

    raw = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  const parsed = ProspeoResponseSchema.safeParse(raw);

  if (!parsed.success) {
    console.warn("[prospeoAdapter] Zod validation failed:", parsed.error.message, "rawResponse:", raw);
    return {
      email: null,
      source: "prospeo",
      rawResponse: raw,
      costUsd: PROVIDER_COSTS.prospeo,
    };
  }

  const email = parsed.data.person?.email?.email ?? null;

  return {
    email,
    source: "prospeo",
    rawResponse: raw,
    costUsd: PROVIDER_COSTS.prospeo,
  };
};
