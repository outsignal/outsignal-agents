/**
 * Prospeo Search Person discovery adapter.
 *
 * Uses Prospeo's /search-person API for bulk B2B person discovery with 20+
 * filters including funding stage, headcount range, and job function.
 *
 * IMPORTANT: This is DISTINCT from src/lib/enrichment/providers/prospeo.ts
 * (email enrichment via /enrich-person). This adapter is for discovery only —
 * it does NOT return email addresses. Email enrichment is Phase 17.
 *
 * Endpoint: POST https://api.prospeo.io/search-person
 * Auth: X-KEY header (same PROSPEO_API_KEY env var as enrichment adapter)
 * Cost: 1 credit per request (~$0.002 at Prospeo credit pricing)
 * Results: 25 per page (fixed by Prospeo)
 *
 * Docs: https://prospeo.io/api/search-person
 */
import { z } from "zod";
import type {
  DiscoveryAdapter,
  DiscoveryFilter,
  DiscoveredPersonResult,
  DiscoveryResult,
} from "../types";

const PROSPEO_SEARCH_ENDPOINT = "https://api.prospeo.io/search-person";
const TIMEOUT_MS = 15_000;

/** Cost of 1 Prospeo credit in USD (1 credit per /search-person request) */
const PROSPEO_SEARCH_CREDIT_COST = 0.002;

function getApiKey(): string {
  const key = process.env.PROSPEO_API_KEY;
  if (!key) throw new Error("PROSPEO_API_KEY environment variable is not set");
  return key;
}

// ---------------------------------------------------------------------------
// Response schema (passthrough to preserve extra fields in rawResponse)
// ---------------------------------------------------------------------------

const ProspeoSearchResultSchema = z
  .object({
    person: z
      .object({
        person_id: z.string().optional(),
        first_name: z.string().optional().nullable(),
        last_name: z.string().optional().nullable(),
        job_title: z.string().optional().nullable(),
        seniority: z.string().optional().nullable(),
        linkedin_url: z.string().optional().nullable(),
        location: z.unknown().optional().nullable(),
      })
      .passthrough(),
    company: z
      .object({
        name: z.string().optional().nullable(),
        domain: z.string().optional().nullable(),
        industry: z.string().optional().nullable(),
        headcount_range: z.string().optional().nullable(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ProspeoSearchResponseSchema = z
  .object({
    results: z.array(ProspeoSearchResultSchema).optional().default([]),
    pagination: z
      .object({
        total_count: z.number().optional().nullable(),
        total_page: z.number().optional().nullable(),
        current_page: z.number().optional().nullable(),
      })
      .optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// ProspeoSearchAdapter
// ---------------------------------------------------------------------------

export class ProspeoSearchAdapter implements DiscoveryAdapter {
  readonly name = "prospeo";

  /**
   * 1 credit per request / ~25 results per page = ~$0.002 per result.
   * Actual cost depends on result count per page.
   */
  readonly estimatedCostPerResult = 0.04;

  /**
   * Search for people using Prospeo's /search-person endpoint.
   *
   * @param filters - Standard DiscoveryFilter criteria
   * @param limit - Desired number of results (Prospeo returns 25/page regardless)
   * @param pageToken - Page number as string (default "1")
   * @param extras - Optional Prospeo-specific filters not in DiscoveryFilter
   *                 (e.g., { company_funding: { include: ["series_a"] }, person_department: { include: ["engineering"] } })
   *                 These are passed through directly to the Prospeo API body.
   */
  async search(
    filters: DiscoveryFilter,
    _limit: number,
    pageToken?: string,
    extras?: Record<string, unknown>
  ): Promise<DiscoveryResult> {
    const apiKey = getApiKey();
    const page = pageToken ? parseInt(pageToken, 10) : 1;

    // Build Prospeo request body — all filter fields go inside a `filters` wrapper
    const f: Record<string, unknown> = {};

    if (filters.jobTitles?.length) {
      f.person_job_title = { include: filters.jobTitles };
    }

    if (filters.seniority?.length) {
      f.person_seniority = { include: filters.seniority };
    }

    if (filters.locations?.length) {
      // Prospeo requires "Country Name #CC" format (e.g., "United Kingdom #GB")
      f.person_location_search = { include: filters.locations };
    }

    if (filters.industries?.length) {
      f.company_industry = { include: filters.industries };
    }

    if (filters.companySizes?.length) {
      // Prospeo accepts size strings as-is: "51-200", "201-500"
      f.company_headcount_range = { include: filters.companySizes };
    }

    if (filters.companyDomains?.length) {
      // Prospeo uses a nested `company.websites` filter, not `company_domain`
      f.company = {
        ...(f.company as Record<string, unknown> | undefined),
        websites: { include: filters.companyDomains },
      };
    }

    if (filters.keywords?.length) {
      f.keywords = { include: filters.keywords };
    }

    if (filters.companyKeywords?.length) {
      f.company_keywords = { include: filters.companyKeywords };
    }

    if (filters.revenueMin || filters.revenueMax) {
      f.company_revenue = {
        min: filters.revenueMin,
        max: filters.revenueMax,
        include_unknown_revenue: false,
      };
    }

    if (filters.fundingStages?.length || filters.fundingTotalMin || filters.fundingTotalMax) {
      f.company_funding = {
        ...(filters.fundingStages?.length ? { stage: filters.fundingStages } : {}),
        ...(filters.fundingTotalMin || filters.fundingTotalMax
          ? { total_funding: { min: filters.fundingTotalMin, max: filters.fundingTotalMax } }
          : {}),
      };
    }

    if (filters.technologies?.length) {
      f.company_technology = { include: filters.technologies };
    }

    if (filters.companyType?.length) {
      f.company_type = filters.companyType[0];
    }

    if (filters.foundedYearMin || filters.foundedYearMax) {
      f.company_founded = {
        min: filters.foundedYearMin,
        max: filters.foundedYearMax,
        include_unknown_founded: true,
      };
    }

    if (filters.naicsCodes?.length) {
      f.company_naics = { include: filters.naicsCodes };
    }

    if (filters.sicCodes?.length) {
      f.company_sics = { include: filters.sicCodes };
    }

    if (filters.departments?.length) {
      f.person_department = { include: filters.departments };
    }

    if (filters.yearsExperienceMin !== undefined || filters.yearsExperienceMax !== undefined) {
      f.person_year_of_experience = {
        min: filters.yearsExperienceMin,
        max: filters.yearsExperienceMax,
      };
    }

    // Merge Prospeo-specific extras into the filters object
    if (extras) {
      Object.assign(f, extras);
    }

    const body: Record<string, unknown> = { filters: f, page };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let raw: unknown;
    try {
      const res = await fetch(PROSPEO_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-KEY": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        if (res.status === 429) {
          const err = new Error("Prospeo Search rate-limited: HTTP 429");
          (err as any).status = 429;
          throw err;
        }
        throw new Error(
          `Prospeo Search API error: ${res.status} ${res.statusText}`
        );
      }

      raw = await res.json();
    } finally {
      clearTimeout(timeout);
    }

    const parsed = ProspeoSearchResponseSchema.safeParse(raw);

    if (!parsed.success) {
      console.warn(
        "[ProspeoSearchAdapter] Zod validation failed:",
        parsed.error.message
      );
      return { people: [], costUsd: 0, rawResponse: raw };
    }

    const data = parsed.data;
    const totalPages = data.pagination?.total_page ?? 0;
    const totalCount = data.pagination?.total_count ?? 0;

    // Map Prospeo results to DiscoveredPersonResult
    const people: DiscoveredPersonResult[] = (data.results ?? []).map(
      (result) => ({
        firstName: result.person.first_name ?? undefined,
        lastName: result.person.last_name ?? undefined,
        jobTitle: result.person.job_title ?? undefined,
        linkedinUrl: result.person.linkedin_url ?? undefined,
        location: typeof result.person.location === "string"
          ? result.person.location
          : result.person.location && typeof result.person.location === "object"
            ? [(result.person.location as Record<string, string>).city, (result.person.location as Record<string, string>).country].filter(Boolean).join(", ") || undefined
            : undefined,
        company: result.company?.name ?? undefined,
        companyDomain: result.company?.domain ?? undefined,
        sourceId: result.person.person_id,
        // email is always undefined — Prospeo search does not return emails
        // Use /enrich-person (Phase 17) with person_id for email lookup
      })
    );

    const hasMore = page < totalPages;
    const nextPageToken = hasMore ? String(page + 1) : undefined;

    return {
      people,
      totalAvailable: totalCount,
      hasMore,
      nextPageToken,
      costUsd: PROSPEO_SEARCH_CREDIT_COST, // 1 credit per /search-person call
      rawResponse: raw,
    };
  }
}

/** Singleton instance for use in agent tools */
export const prospeoSearchAdapter = new ProspeoSearchAdapter();
