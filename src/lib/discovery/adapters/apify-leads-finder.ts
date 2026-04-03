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
import { stripWwwAll, type RateLimits } from "../rate-limit";
import type {
  DiscoveryAdapter,
  DiscoveryFilter,
  DiscoveredPersonResult,
  DiscoveryResult,
} from "../types";

const ACTOR_ID = "code_crafter/leads-finder";

/** Apify Leads Finder rate limits */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 1,
  delayBetweenCalls: 0,
  maxConcurrent: 3,
  dailyCap: null,
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
  const expansions: Record<string, string[]> = {
    "1-10": ["1-10"],
    "11-50": ["11-20", "21-50"],
    "51-200": ["51-100", "101-200"],
    "201-500": ["201-500"],
    "501-1000": ["501-1000"],
    "1001-5000": ["1001-2000", "2001-5000"],
    "5001-10000": ["5001-10000"],
    "10001+": ["10001-20000", "20001-50000", "50000+"],
  };

  const result: string[] = [];
  for (const s of sizes) {
    const mapped = expansions[s];
    if (mapped) {
      result.push(...mapped);
    } else {
      // Pass through if already in actor format
      result.push(s);
    }
  }
  return result;
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
  job_title?: string;
  linkedin?: string;
  company_name?: string;
  company_domain?: string;
  mobile_number?: string;
  city?: string;
  state?: string;
  country?: string;
  [key: string]: unknown;
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
    const people: DiscoveredPersonResult[] = items.map((item) => {
      const locationParts = [item.city, item.state, item.country].filter(Boolean);

      return {
        email: item.email || item.personal_email || undefined,
        firstName: item.first_name ?? undefined,
        lastName: item.last_name ?? undefined,
        jobTitle: item.job_title ?? undefined,
        linkedinUrl: item.linkedin ?? undefined,
        company: item.company_name ?? undefined,
        companyDomain: item.company_domain ?? undefined,
        phone: item.mobile_number ?? undefined,
        location: locationParts.length > 0 ? locationParts.join(", ") : undefined,
      };
    });

    const costUsd = people.length * this.estimatedCostPerResult;

    // Leads Finder returns verified emails from the actor — keep those.
    // No additional enrichment waterfall here. People without emails will be
    // enriched asynchronously via the EnrichmentJob queue after promotion.

    return {
      people,
      totalAvailable: people.length,
      hasMore: false,
      nextPageToken: undefined,
      costUsd,
      rawResponse: items,
    };
  }
}

/** Singleton instance for use in agent tools */
export const apifyLeadsFinderAdapter = new ApifyLeadsFinderAdapter();
