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
  /** Company size ranges: "1-10" | "11-50" | "51-200" | "201-500" | "500+" */
  companySizes?: string[];
  /** Country or city names */
  locations?: string[];
  /** Free-text keywords */
  keywords?: string[];
  /** Target specific company domains */
  companyDomains?: string[];
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
