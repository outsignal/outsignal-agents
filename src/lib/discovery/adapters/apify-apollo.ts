/**
 * Apollo discovery adapter via Apify scraper.
 *
 * Uses the "supreme_coder/apollo-scraper" Apify actor to scrape Apollo.io
 * search results. Unlike the direct Apollo API adapter (./apollo.ts), this
 * one returns email addresses (when available on Apollo profiles) and does
 * not require an Apollo API key — only an Apify token.
 *
 * The adapter converts DiscoveryFilter into an Apollo search URL, passes it
 * to the Apify actor, and maps the scraped results back to our standard
 * DiscoveredPersonResult format.
 *
 * Cost: ~$0.75 per 1,000 leads ($0.00075 per result).
 */
import type {
  DiscoveryAdapter,
  DiscoveryFilter,
  DiscoveredPersonResult,
  DiscoveryResult,
} from "../types";
import { runApifyActor } from "../../apify/client";
import { sizeToApolloRange } from "./apollo";

const ACTOR_ID = "supreme_coder/apollo-scraper";

// ---------------------------------------------------------------------------
// Apollo search URL builder
// ---------------------------------------------------------------------------

/**
 * Map DiscoveryFilter seniority values to Apollo URL param values.
 */
function mapSeniority(s: string): string {
  const map: Record<string, string> = {
    c_suite: "c_suite",
    vp: "vp",
    director: "director",
    manager: "manager",
    ic: "senior",
    senior: "senior",
  };
  return map[s] ?? s;
}

/**
 * Build an Apollo.io people search URL from DiscoveryFilter criteria.
 *
 * Example output:
 * https://app.apollo.io/#/people?page=1&personTitles[]=CTO&personLocations[]=United%20Kingdom
 */
function buildApolloSearchUrl(filters: DiscoveryFilter, page: number): string {
  const params: string[] = [`page=${page}`];

  if (filters.jobTitles?.length) {
    for (const title of filters.jobTitles) {
      params.push(`personTitles[]=${encodeURIComponent(title)}`);
    }
  }

  if (filters.seniority?.length) {
    for (const s of filters.seniority) {
      params.push(
        `personSeniorities[]=${encodeURIComponent(mapSeniority(s))}`
      );
    }
  }

  if (filters.locations?.length) {
    for (const loc of filters.locations) {
      params.push(`personLocations[]=${encodeURIComponent(loc)}`);
    }
  }

  if (filters.companySizes?.length) {
    for (const size of filters.companySizes) {
      params.push(
        `organizationNumEmployeesRanges[]=${encodeURIComponent(sizeToApolloRange(size))}`
      );
    }
  }

  if (filters.industries?.length) {
    for (const ind of filters.industries) {
      params.push(
        `qOrganizationKeywordTags[]=${encodeURIComponent(ind)}`
      );
    }
  }

  if (filters.keywords?.length) {
    params.push(`qKeywords=${encodeURIComponent(filters.keywords.join(" "))}`);
  }

  if (filters.companyDomains?.length) {
    for (const domain of filters.companyDomains) {
      params.push(`organizationDomains[]=${encodeURIComponent(domain)}`);
    }
  }

  return `https://app.apollo.io/#/people?${params.join("&")}`;
}

// ---------------------------------------------------------------------------
// Raw actor result type (scraper output is loosely typed)
// ---------------------------------------------------------------------------

interface ApifyApolloRawResult {
  id?: string;
  email?: string;
  email_address?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  job_title?: string;
  linkedin_url?: string;
  linkedin?: string;
  company?: string;
  organization_name?: string;
  domain?: string;
  company_domain?: string;
  phone?: string;
  phone_number?: string;
  city?: string;
  country?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Result mapper
// ---------------------------------------------------------------------------

/**
 * Map a raw Apify Apollo scraper result to our standard format.
 * Checks multiple possible field names since scraper output can vary.
 */
function mapResult(raw: ApifyApolloRawResult): DiscoveredPersonResult {
  const locationParts = [raw.city, raw.country].filter(Boolean);

  return {
    email: raw.email ?? raw.email_address ?? undefined,
    firstName: raw.first_name ?? undefined,
    lastName: raw.last_name ?? undefined,
    jobTitle: raw.title ?? raw.job_title ?? undefined,
    linkedinUrl: raw.linkedin_url ?? raw.linkedin ?? undefined,
    company: raw.company ?? raw.organization_name ?? undefined,
    companyDomain: raw.domain ?? raw.company_domain ?? undefined,
    phone: raw.phone ?? raw.phone_number ?? undefined,
    location: locationParts.length > 0 ? locationParts.join(", ") : undefined,
    sourceId: raw.id ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// ApifyApolloAdapter
// ---------------------------------------------------------------------------

export class ApifyApolloAdapter implements DiscoveryAdapter {
  readonly name = "apify-apollo";

  /** ~$0.75 per 1,000 leads */
  readonly estimatedCostPerResult = 0.00075;

  /**
   * Search Apollo via Apify scraper.
   *
   * @param filters - Standard DiscoveryFilter criteria
   * @param limit - Number of leads to request from the actor
   * @param pageToken - Page number as string (default "1")
   */
  async search(
    filters: DiscoveryFilter,
    limit: number,
    pageToken?: string
  ): Promise<DiscoveryResult> {
    const page = pageToken ? parseInt(pageToken, 10) : 1;
    const searchUrl = buildApolloSearchUrl(filters, page);

    const items = await runApifyActor<ApifyApolloRawResult>(ACTOR_ID, {
      searchUrl,
      count: limit,
    });

    const people: DiscoveredPersonResult[] = items.map(mapResult);

    // The actor doesn't provide explicit pagination metadata, so we infer
    // based on whether we got as many results as requested.
    const hasMore = people.length >= limit;
    const nextPageToken = hasMore ? String(page + 1) : undefined;

    return {
      people,
      hasMore,
      nextPageToken,
      costUsd: people.length * this.estimatedCostPerResult,
      rawResponse: items,
    };
  }
}

/** Singleton instance for use in agent tools */
export const apifyApolloAdapter = new ApifyApolloAdapter();
