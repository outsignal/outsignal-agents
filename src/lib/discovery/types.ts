/**
 * Discovery adapter interface — the contract all discovery sources must implement.
 * Adding a new discovery source = implement this interface, no other changes needed.
 *
 * Phase 16+ will add concrete adapters: Apollo, Prospeo Search, Serper, Firecrawl.
 */

export interface DiscoveryFilter {
  /** Job titles to search for (e.g., ["CTO", "VP Engineering"]) */
  jobTitles?: string[];
  /** Seniority levels: "c_suite" | "vp" | "director" | "manager" | "ic" */
  seniority?: string[];
  /** Industry names */
  industries?: string[];
  /** Company size ranges (Prospeo-compatible): "1-10" | "11-20" | "21-50" | "51-100" | "101-200" | "201-500" | "501-1000" | "1001-2000" | "2001-5000" | "5001-10000" | "10000+" (also accepts generic: "11-50" | "51-200" | "500+" | "1001-5000" | "5001-10000" — auto-mapped) */
  companySizes?: string[];
  /** Country or city names */
  locations?: string[];
  /** Free-text keywords */
  keywords?: string[];
  /** Target specific company domains */
  companyDomains?: string[];
  /** Company keyword filters (e.g., ["fit-out", "interior design"]) */
  companyKeywords?: string[];

  // --- Company financials & stage ---
  /** Annual revenue range. Values like "<100K", "1M", "10M", "1B", "10B+" */
  revenueMin?: string;
  revenueMax?: string;
  /** Funding stages: "seed", "series_a", "series_b", "series_c", "series_d", "venture_round", "angel", "ipo", etc. */
  fundingStages?: string[];
  /** Minimum total funding amount (e.g., "1M", "5M", "50M") */
  fundingTotalMin?: string;
  /** Maximum total funding amount */
  fundingTotalMax?: string;

  // --- Company characteristics ---
  /** Technologies/tools the company uses (e.g., ["Salesforce", "AWS", "React"]) */
  technologies?: string[];
  /** Company type: "Private", "Public", "Non Profit", "Other" / AI Ark equivalents */
  companyType?: string[];
  /** Founded year range */
  foundedYearMin?: number;
  foundedYearMax?: number;
  /** NAICS industry codes */
  naicsCodes?: string[];
  /** SIC industry codes */
  sicCodes?: string[];

  // --- Person characteristics ---
  /** Department/function: "Sales", "Marketing", "Engineering", etc. */
  departments?: string[];
  /** Minimum years of experience */
  yearsExperienceMin?: number;
  /** Maximum years of experience */
  yearsExperienceMax?: number;
}

export interface DiscoveredPersonResult {
  email?: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  company?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  phone?: string;
  location?: string;
  /** Provider's own ID for this record (for dedup) */
  sourceId?: string;
  /** 0-1 confidence score if provider supplies one */
  confidence?: number;
}

export interface DiscoveryResult {
  people: DiscoveredPersonResult[];
  /** Total matching records available (not just this page) */
  totalAvailable?: number;
  /** Whether more pages are available */
  hasMore?: boolean;
  /** Opaque token for fetching next page */
  nextPageToken?: string;
  /** Actual API cost for this call in USD */
  costUsd: number;
  /** Raw API response for debugging/audit */
  rawResponse?: unknown;
  /** Per-person raw API response objects parallel to people, when adapter can provide them. */
  rawResponses?: unknown[];
}

export interface DiscoveryAdapter {
  /** Human-readable name for this source (e.g., "apollo", "prospeo", "serper") */
  readonly name: string;

  /** Estimated cost per result in USD (for plan preview before execution) */
  readonly estimatedCostPerResult: number;

  /**
   * Search for people matching the given filters.
   * @param filters - ICP criteria to filter by
   * @param limit - Max results to return (adapter may return fewer)
   * @param pageToken - Opaque token from previous result for pagination
   * @returns Discovery result with people array and pagination info
   */
  search(
    filters: DiscoveryFilter,
    limit: number,
    pageToken?: string,
  ): Promise<DiscoveryResult>;
}
