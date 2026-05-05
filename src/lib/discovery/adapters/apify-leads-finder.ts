/**
 * Apify Leads Finder discovery adapter.
 *
 * Uses the `code_crafter/leads-finder` Apify actor to search a 300M+ B2B
 * database and return contacts WITH verified emails.
 *
 * Actor: https://apify.com/code_crafter/leads-finder
 * Cost: ~$0.002 per lead ($2/1K free tier, $1.50/1K Silver+)
 *
 * No pagination — the actor returns all results in a single run based on
 * `fetch_count`. Set hasMore: false always.
 */
import { runApifyActor } from "../../apify/client";
import { decomposeRangesToVendorBands } from "../format-adapters";
import { stripWwwAll, type RateLimits } from "../rate-limit";
import type {
  DiscoveryAdapter,
  DiscoveryFilter,
  DiscoveredPersonResult,
  DiscoveryResult,
} from "../types";

const ACTOR_ID = "code_crafter/leads-finder";
const APIFY_COMPANY_SIZE_BANDS = [
  "1-10",
  "11-20",
  "21-50",
  "51-100",
  "101-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001-20000",
  "20001-50000",
  "50000+",
];

/**
 * Apify Leads Finder rate limits.
 * Source: Apify API docs.
 *
 * Apify platform limits:
 *   - 60 requests/second (default endpoints)
 *   - 400 requests/second (dataset push, request queue)
 *   - Returns 429 with "rate-limit-exceeded"
 *   - Not a bottleneck — constraint is compute credits, not rate limits
 */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 1,
  delayBetweenCalls: 0,          // 60 req/s platform limit — not a bottleneck
  maxConcurrent: 3,
  dailyCap: null,                // Credit-based, not rate-based
};

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** Map DiscoveryFilter seniority values to actor seniority_level values. */
function mapSeniority(values: string[]): string[] {
  const map: Record<string, string> = {
    ic: "senior",
  };
  // Everything else passes through (c_suite, vp, director, manager, senior,
  // founder, owner, partner, head, entry, trainee are all valid actor values)
  return values.map((v) => map[v] ?? v);
}

/**
 * Map DiscoveryFilter company size ranges to the actor's specific bands.
 * DiscoveryFilter uses coarse ranges; the actor uses finer bands.
 */
function mapCompanySizes(sizes: string[]): string[] {
  return decomposeRangesToVendorBands(sizes, APIFY_COMPANY_SIZE_BANDS);
}

/**
 * Map a numeric revenue value to the actor's revenue enum string.
 * Finds the smallest enum bucket that the value fits under.
 */
function mapRevenue(value: string): string {
  // Parse the DiscoveryFilter revenue string (could be "1M", "500K", or a number)
  const num = parseRevenueToNumber(value);
  if (num === undefined) return value; // pass through if unparseable

  const thresholds: [number, string][] = [
    [100_000, "100K"],
    [500_000, "500K"],
    [1_000_000, "1M"],
    [5_000_000, "5M"],
    [10_000_000, "10M"],
    [25_000_000, "25M"],
    [50_000_000, "50M"],
    [100_000_000, "100M"],
    [500_000_000, "500M"],
    [1_000_000_000, "1B"],
    [5_000_000_000, "5B"],
  ];

  for (const [threshold, label] of thresholds) {
    if (num < threshold) return label;
  }
  return "10B";
}

/** Parse a revenue string like "1M", "500K", "100000" to a number. */
function parseRevenueToNumber(value: string): number | undefined {
  const cleaned = value.replace(/[,$\s]/g, "").toUpperCase();

  const multipliers: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  const match = cleaned.match(/^([\d.]+)([KMB])?$/);
  if (!match) return undefined;

  const num = parseFloat(match[1]);
  const mult = match[2] ? multipliers[match[2]] ?? 1 : 1;
  return num * mult;
}

// ---------------------------------------------------------------------------
// Actor output type
// ---------------------------------------------------------------------------

interface LeadsFinderItem {
  email?: string;
  personal_email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  job_title?: string;
  headline?: string;
  linkedin?: string;
  company_name?: string;
  company_domain?: string;
  company_website?: string;
  company_linkedin?: string;
  company_linkedin_uid?: string;
  industry?: string;
  company_description?: string;
  company_annual_revenue?: string;
  company_total_funding_clean?: string | number;
  company_founded_year?: string | number;
  company_phone?: string;
  company_street_address?: string;
  company_full_address?: string;
  company_city?: string;
  company_state?: string;
  company_country?: string;
  company_technologies?: unknown;
  mobile_number?: string;
  city?: string;
  state?: string;
  country?: string;
  [key: string]: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function splitName(fullName: string | undefined): { firstName?: string; lastName?: string } {
  if (!fullName) return {};
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function locationString(city?: string, state?: string, country?: string): string | undefined {
  const parts = [city, state, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function mapLeadsFinderItem(item: LeadsFinderItem): DiscoveredPersonResult {
  const split = splitName(asString(item.full_name));
  const city = asString(item.city);
  const state = asString(item.state);
  const country = asString(item.country);

  return {
    email: asString(item.email) ?? undefined,
    firstName: asString(item.first_name) ?? split.firstName,
    lastName: asString(item.last_name) ?? split.lastName,
    jobTitle: asString(item.job_title),
    linkedinUrl: asString(item.linkedin),
    company: asString(item.company_name),
    companyDomain: asString(item.company_domain),
    location: locationString(city, state, country),
  };
}

// ---------------------------------------------------------------------------
// ApifyLeadsFinderAdapter
// ---------------------------------------------------------------------------

export class ApifyLeadsFinderAdapter implements DiscoveryAdapter {
  readonly name = "apify-leads-finder";
  readonly estimatedCostPerResult = 0.002;

  async search(
    filters: DiscoveryFilter,
    limit: number,
    _pageToken?: string
  ): Promise<DiscoveryResult> {
    const input: Record<string, unknown> = {
      fetch_count: limit,
      email_status: ["validated"],
    };

    // --- Person filters ---

    if (filters.jobTitles?.length) {
      input.contact_job_title = filters.jobTitles;
    }

    if (filters.seniority?.length) {
      input.seniority_level = mapSeniority(filters.seniority);
    }

    if (filters.departments?.length) {
      input.functional_level = filters.departments;
    }

    if (filters.locations?.length) {
      input.contact_location = filters.locations.map((l) => l.toLowerCase());
    }

    // --- Company filters ---

    if (filters.companySizes?.length) {
      input.size = mapCompanySizes(filters.companySizes);
    }

    if (filters.industries?.length) {
      input.company_industry = filters.industries.map((i) => i.toLowerCase());
    }

    if (filters.companyKeywords?.length) {
      input.company_keywords = filters.companyKeywords;
    }

    if (filters.companyDomains?.length) {
      // Strip www. prefixes before sending to API
      input.company_domain = stripWwwAll(filters.companyDomains);
    }

    if (filters.revenueMin) {
      input.min_revenue = mapRevenue(filters.revenueMin);
    }

    if (filters.revenueMax) {
      input.max_revenue = mapRevenue(filters.revenueMax);
    }

    if (filters.fundingStages?.length) {
      input.funding = filters.fundingStages;
    }

    // Run actor (default 300s timeout from apify client)
    const items = await runApifyActor<LeadsFinderItem>(ACTOR_ID, input);

    // Map actor output → DiscoveredPersonResult
    const people: DiscoveredPersonResult[] = items.map(mapLeadsFinderItem);

    const costUsd = people.length * this.estimatedCostPerResult;

    // Leads Finder returns emails claimed as "verified" by Apify, but these
    // are NOT verified by BounceBan (our verification provider). All emails
    // go through BounceBan verification during the enrichment waterfall after
    // promotion. People without emails will also be enriched asynchronously
    // via the EnrichmentJob queue after promotion.

    return {
      people,
      totalAvailable: people.length,
      hasMore: false,
      nextPageToken: undefined,
      costUsd,
      rawResponse: items,
      rawResponses: items,
    };
  }
}

/** Singleton instance for use in agent tools */
export const apifyLeadsFinderAdapter = new ApifyLeadsFinderAdapter();
