/**
 * Google Ads Transparency adapter.
 *
 * Company-level signal checker — NOT a DiscoveryAdapter (domain-based, not filter-based).
 * Uses the Apify actor `silva95gustavo/google-ads-scraper` to scrape the Google Ads
 * Transparency Center for active ad creatives.
 *
 * Two modes:
 *   - checkDomainsForGoogleAds: Check a list of domains for active Google Ads
 *   - searchGoogleAdsAdvertisers: Search by keyword/advertiser name
 *
 * Cost: ~$5/mo flat (Apify actor subscription).
 */

import { runApifyActor } from "@/lib/apify/client";

const ACTOR_ID = "silva95gustavo/google-ads-scraper";
const TRANSPARENCY_BASE = "https://adstransparency.google.com";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw item returned by the Apify actor (one per ad creative). */
interface GoogleAdsRawItem {
  advertiserId?: string;
  advertiserName?: string;
  domain?: string;
  format?: string;
  firstShown?: string;
  lastShown?: string;
  previewUrl?: string;
  adLibraryUrl?: string;
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
 * Group raw actor items by domain and aggregate into GoogleAdsCheckResult[].
 * If items don't carry a `domain` field, falls back to the requested domain list.
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
    const key = (item.domain ?? "").toLowerCase();
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }

  const results: GoogleAdsCheckResult[] = [];

  for (const [domain, ads] of grouped) {
    const formats = [...new Set(ads.map((a) => a.format).filter(Boolean))] as string[];

    const firstShownDates = ads.map((a) => a.firstShown).filter(Boolean) as string[];
    const lastShownDates = ads.map((a) => a.lastShown).filter(Boolean) as string[];

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
    return `${TRANSPARENCY_BASE}/?${params.toString()}`;
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

  const startUrls = [`${TRANSPARENCY_BASE}/?${params.toString()}`];

  const items = await runApifyActor<GoogleAdsRawItem>(ACTOR_ID, { startUrls });

  // Topic searches may return ads across multiple domains/advertisers.
  // Extract unique domains from results.
  const domainsInResults = [
    ...new Set(items.map((i) => (i.domain ?? "").toLowerCase()).filter(Boolean)),
  ];

  return aggregateByDomain(items, domainsInResults);
}
