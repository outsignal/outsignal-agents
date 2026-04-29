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
    .passthrough()
    .optional(),
  company: z.object({}).passthrough().optional(),
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asBigInt(value: unknown): bigint | undefined {
  const numberValue = asNumber(value);
  if (numberValue == null || !Number.isFinite(numberValue)) return undefined;
  return BigInt(Math.trunc(numberValue));
}

function asDate(value: unknown): Date | undefined {
  const stringValue = asString(value);
  if (!stringValue) return undefined;
  const date = new Date(stringValue);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function compactRecord(values: Record<string, string | undefined>): Record<string, string> | undefined {
  const compacted = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value != null),
  ) as Record<string, string>;
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function extractFunding(funding: Record<string, unknown> | null): Pick<
  NonNullable<EmailProviderResult["companyData"]>,
  "fundingTotal" | "fundingStageLatest" | "fundingLatestDate" | "fundingEvents"
> {
  if (!funding) return {};

  const latest = asRecord(funding.latest) ?? asRecord(funding.latest_round) ?? asRecord(funding.last_round);
  return {
    fundingTotal:
      asBigInt(funding.total) ??
      asBigInt(funding.total_funding) ??
      asBigInt(funding.funding_total),
    fundingStageLatest:
      asString(funding.stage_latest) ??
      asString(funding.latest_stage) ??
      asString(latest?.stage),
    fundingLatestDate:
      asDate(funding.latest_date) ??
      asDate(funding.last_funding_date) ??
      asDate(latest?.date),
    fundingEvents:
      asArray(funding.events) ??
      asArray(funding.rounds) ??
      asArray(funding.funding_rounds),
  };
}

function extractJobPostings(jobPostings: Record<string, unknown> | null): Pick<
  NonNullable<EmailProviderResult["companyData"]>,
  "jobPostingsActiveCount" | "jobPostingTitles"
> {
  if (!jobPostings) return {};

  const postings =
    asArray(jobPostings.jobs) ??
    asArray(jobPostings.postings) ??
    asArray(jobPostings.job_postings);
  const titles =
    asArray(jobPostings.titles)
      ?.map(asString)
      .filter((title): title is string => Boolean(title)) ??
    postings
      ?.map((posting) => asString(asRecord(posting)?.title))
      .filter((title): title is string => Boolean(title));

  return {
    jobPostingsActiveCount:
      asNumber(jobPostings.active_count) ??
      asNumber(jobPostings.active) ??
      asNumber(jobPostings.count) ??
      asNumber(jobPostings.total) ??
      postings?.length,
    jobPostingTitles: titles && titles.length > 0 ? titles : undefined,
  };
}

export function mapProspeoPayload(raw: unknown): Omit<EmailProviderResult, "source" | "rawResponse" | "costUsd"> {
  const root = asRecord(raw) ?? {};
  const person = asRecord(root.person);
  const company = asRecord(root.company);
  const email = asString(asRecord(person?.email)?.email) ?? null;
  const personId = asString(person?.person_id);
  const companyId = asString(company?.company_id);
  const mobile = asRecord(person?.mobile);
  const personLocation = asRecord(person?.location);
  const companyLocation = asRecord(company?.location);
  const phoneHq = asRecord(company?.phone_hq);
  const funding = asRecord(company?.funding);
  const jobPostings = asRecord(company?.job_postings);

  const mobilePhone =
    mobile?.revealed === true
      ? asString(mobile.mobile) ?? asString(mobile.phone)
      : undefined;
  const socialUrls = compactRecord({
    linkedin: asString(company?.linkedin_url),
    twitter: asString(company?.twitter_url),
    facebook: asString(company?.facebook_url),
    instagram: asString(company?.instagram_url),
    youtube: asString(company?.youtube_url),
    crunchbase: asString(company?.crunchbase_url),
  });

  return {
    email,
    providerIds: personId ? { prospeoPersonId: personId } : undefined,
    headline: asString(person?.headline),
    skills: asArray(person?.skills),
    jobHistory: asArray(person?.job_history),
    mobilePhone,
    locationCity: asString(personLocation?.city),
    locationState: asString(personLocation?.state),
    locationCountry: asString(personLocation?.country),
    locationCountryCode: asString(personLocation?.country_code),
    companyData: company ? {
      name: asString(company.name),
      domain: asString(company.domain),
      industry: asString(company.industry),
      headcount:
        asNumber(company.employee_count) ??
        asNumber(company.employees) ??
        asNumber(company.headcount),
      website: asString(company.website) ?? asString(company.domain),
      location: asString(companyLocation?.city) && asString(companyLocation?.country)
        ? `${asString(companyLocation?.city)}, ${asString(companyLocation?.country)}`
        : asString(companyLocation?.country),
      yearFounded: asNumber(company.founded),
      revenue: asString(company.revenue_range_printed),
      linkedinUrl: asString(company.linkedin_url),
      providerIds: companyId ? { prospeoCompanyId: companyId } : undefined,
      hqPhone: asString(phoneHq?.phone_hq),
      hqAddress: asString(companyLocation?.address) ?? asString(companyLocation?.raw_address),
      hqCity: asString(companyLocation?.city),
      hqState: asString(companyLocation?.state),
      hqCountry: asString(companyLocation?.country),
      hqCountryCode: asString(companyLocation?.country_code),
      socialUrls,
      technologies: company.technology,
      ...extractFunding(funding),
      ...extractJobPostings(jobPostings),
    } : undefined,
  };
}

function buildProspeoResult(raw: unknown, costUsd: number): EmailProviderResult {
  return {
    ...mapProspeoPayload(raw),
    source: "prospeo",
    rawResponse: raw,
    costUsd,
  };
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
          results.set(match.identifier, buildProspeoResult(match, PROVIDER_COSTS.prospeo));
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
// Bulk enrichment by Prospeo person_id (source-first)
// ---------------------------------------------------------------------------

/**
 * Bulk enrich by Prospeo person_id — much higher hit rate than name/LinkedIn matching.
 * Uses the same /bulk-enrich-person endpoint but passes `person_id` as the direct
 * lookup identifier. No name/company matching needed — Prospeo resolves by internal ID.
 *
 * This is the preferred path for people originally discovered via Prospeo Search,
 * since we already have their person_id from the search results.
 *
 * @param people - Array of { personId (our DB ID), prospeoPersonId (Prospeo's person_id) }
 * @returns Map of our personId → EmailProviderResult
 */
export async function bulkEnrichByPersonId(
  people: Array<{ personId: string; prospeoPersonId: string }>,
): Promise<Map<string, EmailProviderResult>> {
  const results = new Map<string, EmailProviderResult>();
  const apiKey = getApiKey();

  // Chunk into batches of 50 (Prospeo bulk limit)
  for (let i = 0; i < people.length; i += BULK_BATCH_SIZE) {
    const batch = people.slice(i, i + BULK_BATCH_SIZE);

    const dataPoints = batch.map((p) => ({
      identifier: p.personId,
      person_id: p.prospeoPersonId,
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

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
        const err = new Error("Prospeo bulk (person_id) rate-limited: HTTP 429");
        (err as any).status = 429;
        throw err;
      }

      if (!res.ok) {
        throw new Error(`Prospeo bulk (person_id) HTTP error: ${res.status} ${res.statusText}`);
      }

      const raw = await res.json();
      const parsed = ProspeosBulkResponseSchema.safeParse(raw);

      if (!parsed.success) {
        console.warn("[prospeo-bulk-person-id] Zod validation failed:", parsed.error.message);
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

      const matchedIds = new Set<string>();
      if (parsed.data.matched) {
        for (const match of parsed.data.matched) {
          matchedIds.add(match.identifier);
          results.set(match.identifier, buildProspeoResult(match, PROVIDER_COSTS.prospeo));
        }
      }

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

      if (parsed.data.invalid_datapoints) {
        for (const id of parsed.data.invalid_datapoints) {
          if (!matchedIds.has(id)) {
            results.set(id, {
              email: null,
              source: "prospeo",
              rawResponse: { invalid_datapoint: true },
              costUsd: 0,
            });
          }
        }
      }

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
      ? {
          enrich_mobile: true,
          only_verified_mobile: true,
          data: { linkedin_url: input.linkedinUrl },
        }
      : {
          enrich_mobile: true,
          only_verified_mobile: true,
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

  return buildProspeoResult(raw, PROVIDER_COSTS.prospeo);
};
