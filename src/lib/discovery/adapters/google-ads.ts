/**
 * Google Ads Transparency adapter.
 *
 * Company-level signal checker — NOT a DiscoveryAdapter (domain-based, not filter-based).
 * Uses the Apify actor `lexis-solutions/google-ads-scraper` (4.9/5 rating) to scrape
 * the Google Ads Transparency Center for active ad creatives.
 *
 * Two modes:
 *   - checkDomainsForGoogleAds: Check a list of domains for active Google Ads
 *   - searchGoogleAdsAdvertisers: Search by keyword/advertiser name
 *
 * Cost: ~$25/mo rental (Apify actor subscription).
 */

import { runApifyActor } from "@/lib/apify/client";
import type { RateLimits } from "../rate-limit";

const ACTOR_ID = "lexis-solutions/google-ads-scraper";
const TRANSPARENCY_BASE = "https://adstransparency.google.com";

/** Adyntel / Google Ads Transparency adapter rate limits */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 1,
  delayBetweenCalls: 0,
  maxConcurrent: 1,
  dailyCap: 900,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw item returned by the lexis-solutions actor (one per ad creative). */
interface GoogleAdsRawItem {
  id?: string;
  advertiserId?: string;
  creativeId?: string;
  advertiserName?: string;
  format?: string;
  url?: string;
  previewUrl?: string;
  firstShownAt?: number; // unix timestamp
  lastShownAt?: number; // unix timestamp
  impressions?: unknown;
  shownCountries?: string[];
  countryStats?: unknown;
  audienceSelections?: unknown;
  variants?: unknown;
  /** Contains the queried domain URL, e.g. https://adstransparency.google.com/?domain=example.com */
  originUrl?: string;
}

/** Aggregated result for a single domain or advertiser. */
export interface GoogleAdsCheckResult {
  domain: string;
  hasAds: boolean;
  adCount: number;
  advertiserName?: string;
  advertiserId?: string;
  /** Unique ad formats found (e.g. TEXT, IMAGE, VIDEO). */
  formats: string[];
  /** Most recent lastShown date across all ads. */
  latestAdDate?: string;
  /** Earliest firstShown date across all ads. */
  oldestAdDate?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract domain from a lexis-solutions originUrl.
 * Format: `https://adstransparency.google.com/?domain=example.com`
 */
function extractDomainFromOriginUrl(originUrl: string): string | null {
  try {
    return new URL(originUrl).searchParams.get("domain");
  } catch {
    return null;
  }
}

/** Convert a unix timestamp (seconds) to an ISO date string, or undefined. */
function unixToISO(ts: number | undefined): string | undefined {
  if (ts == null) return undefined;
  return new Date(ts * 1000).toISOString();
}

/**
 * Group raw actor items by domain and aggregate into GoogleAdsCheckResult[].
 * Extracts domain from `originUrl` (lexis-solutions format), with fallback.
 */
function aggregateByDomain(
  items: GoogleAdsRawItem[],
  requestedDomains: string[],
): GoogleAdsCheckResult[] {
  const grouped = new Map<string, GoogleAdsRawItem[]>();

  // Seed every requested domain so we report hasAds: false for those with no results.
  for (const d of requestedDomains) {
    grouped.set(d.toLowerCase(), []);
  }

  for (const item of items) {
    const key = (
      (item.originUrl ? extractDomainFromOriginUrl(item.originUrl) : null) ?? ""
    ).toLowerCase();
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }

  const results: GoogleAdsCheckResult[] = [];

  for (const [domain, ads] of grouped) {
    const formats = [...new Set(ads.map((a) => a.format).filter(Boolean))] as string[];

    const firstShownDates = ads
      .map((a) => unixToISO(a.firstShownAt))
      .filter(Boolean) as string[];
    const lastShownDates = ads
      .map((a) => unixToISO(a.lastShownAt))
      .filter(Boolean) as string[];

    results.push({
      domain,
      hasAds: ads.length > 0,
      adCount: ads.length,
      advertiserName: ads[0]?.advertiserName,
      advertiserId: ads[0]?.advertiserId,
      formats,
      latestAdDate: lastShownDates.length
        ? lastShownDates.sort().at(-1)
        : undefined,
      oldestAdDate: firstShownDates.length
        ? firstShownDates.sort().at(0)
        : undefined,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check a list of company domains for active Google Ads.
 *
 * Constructs Transparency Center URLs for each domain, runs the Apify actor
 * once with all URLs, and returns aggregated results per domain.
 */
export async function checkDomainsForGoogleAds(
  domains: string[],
  options?: { region?: string },
): Promise<GoogleAdsCheckResult[]> {
  if (domains.length === 0) return [];

  const startUrls = domains.map((d) => {
    const params = new URLSearchParams({ domain: d });
    if (options?.region) params.set("region", options.region);
    return { url: `${TRANSPARENCY_BASE}/?${params.toString()}` };
  });

  const items = await runApifyActor<GoogleAdsRawItem>(ACTOR_ID, { startUrls });

  return aggregateByDomain(items, domains);
}

/**
 * Search the Google Ads Transparency Center by keyword or advertiser name.
 *
 * Returns matching advertisers with their domains and ad counts.
 */
export async function searchGoogleAdsAdvertisers(
  query: string,
  options?: { region?: string },
): Promise<GoogleAdsCheckResult[]> {
  const params = new URLSearchParams({ topic: query });
  if (options?.region) params.set("region", options.region);

  const startUrls = [{ url: `${TRANSPARENCY_BASE}/?${params.toString()}` }];

  const items = await runApifyActor<GoogleAdsRawItem>(ACTOR_ID, { startUrls });

  // Topic searches may return ads across multiple domains/advertisers.
  // Extract unique domains from results.
  const domainsInResults = [
    ...new Set(
      items
        .map((i) =>
          (i.originUrl ? extractDomainFromOriginUrl(i.originUrl) : null) ?? "",
        )
        .map((d) => d.toLowerCase())
        .filter(Boolean),
    ),
  ];

  return aggregateByDomain(items, domainsInResults);
}
