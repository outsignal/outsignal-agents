/**
 * AI Ark Search discovery adapter.
 *
 * Uses the AI Ark People Search API for bulk discovery by seniority, industry,
 * location, employee size, and company domain. This is DISTINCT from
 * aiark-person.ts (which enriches individual people by LinkedIn URL).
 *
 * Rate limits: 5 req/s, 300 req/min. The calling agent controls frequency;
 * this adapter throws { status: 429 } on rate limit for upstream retry.
 *
 * Auth: HIGH CONFIDENCE — `X-TOKEN` header confirmed via live API testing.
 *
 * Filter confidence (based on live API testing 2026-03):
 *   contact.seniority        — HIGH CONFIDENCE, works correctly
 *   account.industry          — HIGH CONFIDENCE, works correctly
 *   account.location          — HIGH CONFIDENCE, filters by company HQ
 *   account.employeeSize      — HIGH CONFIDENCE, RANGE type works correctly
 *   account.domain            — HIGH CONFIDENCE, should work (same any/include pattern)
 *   contact.experience.current.title — HIGH CONFIDENCE, works with {mode,content} format
 *   contact.department        — BUGGED: returns all records ignoring the filter
 *   contact.keyword           — BROKEN: returns 400 "request not readable" (no workaround)
 *
 * companyKeywords workaround:
 *   account.keyword on /v1/people returns 500 "cannot serialize", but the same
 *   keyword filter works on /v1/companies. So we do a two-step search: first
 *   fetch matching company domains via /v1/companies, then use those domains
 *   as an account.domain filter on /v1/people.
 */

import { z } from "zod";
import type { DiscoveredPersonResult, DiscoveryAdapter, DiscoveryFilter, DiscoveryResult } from "../types";
import { enrichViaAiArk } from "../aiark-email";
import { bulkEnrichPeople } from "../bulk-enrich";
import { enrichViaKitt } from "../kitt-email";
import { verifyDiscoveredEmails } from "../verify-email";
import { CreditExhaustionError, isCreditExhaustion } from "@/lib/enrichment/credit-exhaustion";
import { stripWwwAll, type RateLimits } from "../rate-limit";

const AIARK_PEOPLE_ENDPOINT = "https://api.ai-ark.com/api/developer-portal/v1/people";
const AIARK_COMPANIES_ENDPOINT = "https://api.ai-ark.com/api/developer-portal/v1/companies";

/** AI Ark adapter rate limits */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 100,
  delayBetweenCalls: 200,
  maxConcurrent: 1,
  dailyCap: null,
};

/** Auth header name — confirmed working via live testing. */
const AUTH_HEADER_NAME = "X-TOKEN";

const REQUEST_TIMEOUT_MS = 15_000;

function getApiKey(): string {
  const key = process.env.AIARK_API_KEY;
  if (!key) {
    throw new Error("AIARK_API_KEY environment variable is not set");
  }
  return key;
}

// ---------------------------------------------------------------------------
// Zod schemas — match the actual nested AI Ark response structure
// ---------------------------------------------------------------------------

const AiArkPersonSchema = z
  .object({
    id: z.string().optional(),
    profile: z
      .object({
        first_name: z.string().optional().nullable(),
        last_name: z.string().optional().nullable(),
        full_name: z.string().optional().nullable(),
        title: z.string().optional().nullable(),
        headline: z.string().optional().nullable(),
      })
      .passthrough()
      .optional(),
    link: z
      .object({
        linkedin: z.string().optional().nullable(),
      })
      .passthrough()
      .optional(),
    location: z
      .object({
        country: z.string().optional().nullable(),
        city: z.string().optional().nullable(),
        default: z.string().optional().nullable(),
      })
      .passthrough()
      .optional(),
    department: z
      .object({
        seniority: z.string().optional().nullable(),
        departments: z.array(z.string()).optional().nullable(),
        functions: z.array(z.string()).optional().nullable(),
      })
      .passthrough()
      .optional(),
    company: z
      .object({
        id: z.string().optional(),
        summary: z
          .object({
            name: z.string().optional().nullable(),
            industry: z.string().optional().nullable(),
            staff: z
              .object({
                total: z.number().optional().nullable(),
                range: z
                  .object({
                    start: z.number().optional(),
                    end: z.number().optional(),
                  })
                  .optional()
                  .nullable(),
              })
              .passthrough()
              .optional()
              .nullable(),
          })
          .passthrough()
          .optional(),
        link: z
          .object({
            domain: z.string().optional().nullable(),
            linkedin: z.string().optional().nullable(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const AiArkSearchResponseSchema = z
  .object({
    content: z.array(AiArkPersonSchema).optional().default([]),
    totalElements: z.number().optional().nullable(),
    totalPages: z.number().optional().nullable(),
    numberOfElements: z.number().optional().nullable(),
    trackId: z.string().optional().nullable(),
    pageable: z
      .object({
        pageNumber: z.number().optional(),
        pageSize: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const AiArkCompanySchema = z
  .object({
    id: z.string().optional(),
    summary: z
      .object({
        name: z.string().optional().nullable(),
        industry: z.string().optional().nullable(),
      })
      .passthrough()
      .optional(),
    link: z
      .object({
        domain: z.string().optional().nullable(),
        linkedin: z.string().optional().nullable(),
      })
      .passthrough()
      .optional(),
    staff: z
      .object({
        total: z.number().optional().nullable(),
        range: z
          .object({
            start: z.number().optional(),
            end: z.number().optional(),
          })
          .optional()
          .nullable(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const AiArkCompaniesResponseSchema = z
  .object({
    content: z.array(AiArkCompanySchema).optional().default([]),
    totalElements: z.number().optional().nullable(),
    totalPages: z.number().optional().nullable(),
    pageable: z
      .object({
        pageNumber: z.number().optional(),
        pageSize: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a company size string like "11-50" or "500+" into a range object
 * for the account.employeeSize RANGE filter.
 */
function parseCompanySizeRange(size: string): { start: number; end: number } {
  if (size.endsWith("+")) {
    return { start: parseInt(size, 10), end: 1_000_000 };
  }
  const [start, end] = size.split("-").map(Number);
  return { start: start || 1, end: end || start };
}

/**
 * Parse a revenue string like "1M", "500K", "1B" into a numeric value.
 * Used for account.revenue and account.funding.totalAmount RANGE filters.
 */
function parseRevenueString(val: string): number {
  const map: Record<string, number> = {
    "<100K": 0,
    "100K": 100_000,
    "500K": 500_000,
    "1M": 1_000_000,
    "5M": 5_000_000,
    "10M": 10_000_000,
    "25M": 25_000_000,
    "50M": 50_000_000,
    "100M": 100_000_000,
    "250M": 250_000_000,
    "500M": 500_000_000,
    "1B": 1_000_000_000,
    "5B": 5_000_000_000,
    "10B+": 10_000_000_000,
  };
  return map[val] ?? 0;
}

/**
 * Build the AI Ark request body from DiscoveryFilter.
 *
 * The API expects nested `contact` and `account` objects with filters using
 * the `{ any: { include: [...] } }` pattern for most fields.
 */
function buildRequestBody(
  filters: DiscoveryFilter,
  page: number,
  size: number,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { page, size };
  const contact: Record<string, unknown> = {};
  const account: Record<string, unknown> = {};

  // jobTitles → contact.experience.current.title (WORKS)
  // Uses {mode, content} format — SMART mode for fuzzy matching
  if (filters.jobTitles?.length) {
    contact.experience = {
      current: {
        title: { any: { include: { mode: "SMART", content: filters.jobTitles } } },
      },
    };
  }

  // seniority → contact.seniority (WORKS)
  if (filters.seniority?.length) {
    contact.seniority = { any: { include: filters.seniority } };
  }

  // locations → account.location (WORKS — filters by company HQ)
  if (filters.locations?.length) {
    account.location = { any: { include: filters.locations } };
  }

  // industries → account.industry (WORKS)
  if (filters.industries?.length) {
    account.industry = { any: { include: filters.industries } };
  }

  // companySizes → account.employeeSize (WORKS)
  // Parse "11-50" → {start: 11, end: 50}, "500+" → {start: 500, end: 1000000}
  if (filters.companySizes?.length) {
    account.employeeSize = {
      type: "RANGE",
      range: filters.companySizes.map(parseCompanySizeRange),
    };
  }

  // companyDomains → account.domain (should work — same any/include pattern)
  if (filters.companyDomains?.length) {
    // Strip www. prefixes before sending to API
    account.domain = { any: { include: stripWwwAll(filters.companyDomains) } };
  }

  // revenue → account.revenue (RANGE filter)
  if (filters.revenueMin || filters.revenueMax) {
    account.revenue = {
      type: "RANGE",
      range: [
        {
          start: filters.revenueMin ? parseRevenueString(filters.revenueMin) : 0,
          end: filters.revenueMax ? parseRevenueString(filters.revenueMax) : 100_000_000_000,
        },
      ],
    };
  }

  // funding → account.funding (stages + optional totalAmount range)
  if (filters.fundingStages?.length || filters.fundingTotalMin || filters.fundingTotalMax) {
    const funding: Record<string, unknown> = {};
    if (filters.fundingStages?.length) {
      funding.type = filters.fundingStages;
    }
    if (filters.fundingTotalMin || filters.fundingTotalMax) {
      funding.totalAmount = {
        start: filters.fundingTotalMin ? parseRevenueString(filters.fundingTotalMin) : 0,
        end: filters.fundingTotalMax ? parseRevenueString(filters.fundingTotalMax) : 100_000_000_000,
      };
    }
    account.funding = funding;
  }

  // technologies → account.technology
  if (filters.technologies?.length) {
    account.technology = { any: { include: filters.technologies } };
  }

  // companyType → account.type
  if (filters.companyType?.length) {
    account.type = { any: { include: filters.companyType } };
  }

  // foundedYear → account.foundedYear (RANGE filter)
  if (filters.foundedYearMin || filters.foundedYearMax) {
    account.foundedYear = {
      type: "RANGE",
      range: {
        start: filters.foundedYearMin ?? 1900,
        end: filters.foundedYearMax ?? new Date().getFullYear(),
      },
    };
  }

  // naicsCodes → account.naics
  if (filters.naicsCodes?.length) {
    account.naics = { any: { include: filters.naicsCodes } };
  }

  // BUGGED: AI Ark ignores this filter (returns all records) — included for when they fix it
  // departments → contact.department
  if (filters.departments?.length) {
    contact.department = { any: { include: filters.departments } };
  }

  // yearsExperience: AI Ark path not confirmed, skipping

  // keywords → not sent (contact.keyword returns 400, no workaround)
  // companyKeywords → handled via two-step workaround in search() method

  // Merge adapter-specific extras into the contact/account objects
  if (extras) {
    const { contact: extraContact, account: extraAccount, ...rest } = extras as Record<string, unknown>;
    if (extraContact && typeof extraContact === "object") {
      Object.assign(contact, extraContact);
    }
    if (extraAccount && typeof extraAccount === "object") {
      Object.assign(account, extraAccount);
    }
    // Any top-level extras go directly on the body
    Object.assign(body, rest);
  }

  if (Object.keys(contact).length) body.contact = contact;
  if (Object.keys(account).length) body.account = account;

  return body;
}

/**
 * Map an AI Ark person record to the common DiscoveredPersonResult shape.
 */
function mapPerson(person: z.infer<typeof AiArkPersonSchema>): DiscoveredPersonResult {
  return {
    firstName: person.profile?.first_name ?? undefined,
    lastName: person.profile?.last_name ?? undefined,
    jobTitle: person.profile?.title ?? undefined,
    linkedinUrl: person.link?.linkedin ?? undefined,
    location: person.location?.default ?? person.location?.country ?? undefined,
    company: person.company?.summary?.name ?? undefined,
    companyDomain: person.company?.link?.domain ?? undefined,
    sourceId: person.id,
  };
}

// ---------------------------------------------------------------------------
// Adapter class
// ---------------------------------------------------------------------------

/**
 * AI Ark Search discovery adapter.
 * Implements DiscoveryAdapter — searches people by seniority, location,
 * industry, employee size, and company domains with zero-based pagination.
 */
export class AiArkSearchAdapter implements DiscoveryAdapter {
  readonly name = "aiark";

  /**
   * Estimated cost per result: ~$0.003 per API call regardless of result count.
   * AI Ark charges per call, not per result.
   */
  readonly estimatedCostPerResult = 0.003;

  /**
   * Two-step workaround: search /v1/companies by keyword to get domains,
   * then use those domains as a filter on /v1/people.
   */
  private async searchCompanyDomainsByKeyword(keywords: string[]): Promise<string[]> {
    const apiKey = getApiKey();

    const requestBody = {
      account: {
        keyword: {
          sources: [{ mode: "INCLUDE", source: "KEYWORD" }],
          content: keywords,
        },
      },
      page: 0,
      size: 100,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let raw: unknown;

    try {
      const response = await fetch(AIARK_COMPANIES_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "accept": "application/json",
          [AUTH_HEADER_NAME]: apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(
          `AI Ark companies keyword search failed: HTTP ${response.status}`,
        );
        return [];
      }

      raw = await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (isCreditExhaustion(err)) throw err;
      console.warn("AI Ark companies keyword search error:", err);
      return [];
    }

    const parsed = AiArkCompaniesResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("AI Ark companies: response did not match schema:", parsed.error.message);
      return [];
    }

    // Extract unique domains, filtering out nulls/undefined
    const domains = parsed.data.content
      .map((c) => c.link?.domain)
      .filter((d): d is string => !!d);

    return Array.from(new Set(domains));
  }

  async search(
    filters: DiscoveryFilter,
    limit: number,
    pageToken?: string,
    extras?: Record<string, unknown>,
  ): Promise<DiscoveryResult> {
    const apiKey = getApiKey();

    // Track extra cost from the companies keyword lookup
    let extraCost = 0;

    // Two-step workaround: resolve companyKeywords → domains first
    if (filters.companyKeywords?.length) {
      const keywordDomains = await this.searchCompanyDomainsByKeyword(filters.companyKeywords);
      extraCost = 0.003; // one extra API call

      if (keywordDomains.length) {
        // Merge with any user-provided companyDomains, dedup
        const existing = filters.companyDomains ?? [];
        const merged = Array.from(new Set(existing.concat(keywordDomains)));
        filters = { ...filters, companyDomains: merged };
      }
    }

    // Page is zero-based; pageToken is a stringified integer
    const page = pageToken ? parseInt(pageToken, 10) : 0;
    const size = Math.min(limit, 100);

    const requestBody = buildRequestBody(filters, page, size, extras);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let raw: unknown;

    try {
      const response = await fetch(AIARK_PEOPLE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "accept": "application/json",
          [AUTH_HEADER_NAME]: apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 402 || response.status === 403) {
        throw new CreditExhaustionError("aiark", response.status, "AI Ark search credits exhausted");
      }

      if (response.status === 401) {
        console.warn(
          `AI Ark search auth failed (${response.status}) — verify AIARK_API_KEY env var. ` +
            `Auth header: "${AUTH_HEADER_NAME}".`,
        );
        throw new Error(`AI Ark search auth error: HTTP ${response.status}`);
      }

      if (response.status === 429) {
        // Rate limit: 5 req/s, 300 req/min. Throw with status for upstream retry.
        throw Object.assign(new Error("AI Ark rate limit exceeded"), { status: 429 });
      }

      if (!response.ok) {
        throw Object.assign(
          new Error(`AI Ark search unexpected error: HTTP ${response.status}`),
          { status: response.status },
        );
      }

      raw = await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }

    // Parse the response envelope
    const parsed = AiArkSearchResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("AI Ark search: response did not match expected schema:", parsed.error.message);
      return {
        people: [],
        totalAvailable: 0,
        hasMore: false,
        costUsd: 0.003 + extraCost,
        rawResponse: raw,
      };
    }

    const data = parsed.data;
    const totalElements = data.totalElements ?? 0;

    // Map each person record from data.content
    const people: DiscoveredPersonResult[] = data.content.flatMap((item) => {
      const personParsed = AiArkPersonSchema.safeParse(item);
      if (!personParsed.success) {
        console.warn("AI Ark search: skipping invalid person record:", personParsed.error.message);
        return [];
      }
      return [mapPerson(personParsed.data)];
    });

    // Next page exists if we've fetched fewer total records than available
    const fetchedSoFar = (page + 1) * size;
    const hasMore = totalElements > 0 ? fetchedSoFar < totalElements : people.length === size;
    const nextPageToken = hasMore ? String(page + 1) : undefined;

    // Three-stage email enrichment waterfall + verification:
    // 1. AI Ark native email finding (uses sourceId — emails are BounceBan-verified at source)
    // 2. Prospeo bulk-enrich fallback for anyone still without an email
    // 3. Kitt find fallback for anyone still without an email (replaces LeadMagic)
    // 4. Verify all non-AI-Ark emails via BounceBan (AI Ark emails skip — already verified)
    let enrichCost = 0;
    if (people.length > 0) {
      // Track which indices got emails from AI Ark (pre-verified, skip re-verification)
      const aiArkEmailIndices = new Set<number>();

      // Stage 1: AI Ark /export/single for people with sourceId
      const beforeAiArk = people.map((p) => p.email);
      const aiArkResult = await enrichViaAiArk(people);
      enrichCost += aiArkResult.costUsd;

      // Record indices that got emails from AI Ark
      for (let idx = 0; idx < people.length; idx++) {
        if (!beforeAiArk[idx] && people[idx].email) {
          aiArkEmailIndices.add(idx);
        }
      }

      // Stage 2: Prospeo fallback for people still missing email
      const needsProspeo = people.filter((p) => !p.email);
      if (needsProspeo.length > 0) {
        console.log(
          `[aiark-search] ${aiArkResult.enriched} emails from AI Ark, ${needsProspeo.length} remaining — falling back to Prospeo`,
        );
        const prospeoResult = await bulkEnrichPeople(people, "aiark");
        enrichCost += prospeoResult.costUsd;
      }

      // Stage 3: Kitt fallback for people still missing email
      const needsKitt = people.filter((p) => !p.email);
      if (needsKitt.length > 0) {
        console.log(
          `[aiark-search] ${needsKitt.length} still without email after AI Ark + Prospeo — falling back to Kitt`,
        );
        const kittResult = await enrichViaKitt(people);
        enrichCost += kittResult.costUsd;
      }

      // Stage 4: Verify all non-AI-Ark emails via BounceBan
      const emailsToVerify = people.filter((p, idx) => p.email && !aiArkEmailIndices.has(idx));
      if (emailsToVerify.length > 0) {
        console.log(
          `[aiark-search] Verifying ${emailsToVerify.length} non-AI-Ark emails via BounceBan`,
        );
        const verifyResult = await verifyDiscoveredEmails(people, aiArkEmailIndices);
        enrichCost += verifyResult.costUsd;
      }
    }

    return {
      people,
      totalAvailable: totalElements || undefined,
      hasMore,
      nextPageToken,
      // Cost: one credit per people API call + optional companies keyword call + enrichment
      costUsd: 0.003 + extraCost + enrichCost,
      rawResponse: raw,
    };
  }
}

/** Singleton instance for use throughout the application. */
export const aiarkSearchAdapter = new AiArkSearchAdapter();
