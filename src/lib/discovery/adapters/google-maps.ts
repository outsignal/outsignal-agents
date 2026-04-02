/**
 * Google Maps / Google Places adapter.
 *
 * Company-level discovery tool — searches Google Maps for businesses by
 * keyword and location using the Apify actor `compass/crawler-google-places`.
 *
 * Primary use case: local/SMB business discovery — e.g. finding umbrella
 * company prospects for 1210 Solutions, restaurants in a city, contractors
 * in a region, etc.
 *
 * Cost: ~$0.005 per search (Apify compute).
 */

import { runApifyActor } from "@/lib/apify/client";
import type { RateLimits } from "../rate-limit";

const ACTOR_ID = "compass/crawler-google-places";

/** Google Maps adapter rate limits */
export const RATE_LIMITS: RateLimits = {
  maxBatchSize: 20,
  delayBetweenCalls: 0,
  maxConcurrent: 1,
  dailyCap: null,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw item returned by the Apify actor (one per place). */
interface GoogleMapsRawItem {
  title?: string;
  address?: string;
  phone?: string;
  website?: string;
  totalScore?: number;
  reviewsCount?: number;
  categoryName?: string;
  categories?: string[];
  city?: string;
  countryCode?: string;
  placeId?: string;
  url?: string;
  location?: {
    lat?: number;
    lng?: number;
  };
}

/** Processed result for a single Google Maps place. */
export interface GoogleMapsResult {
  /** Business name. */
  name: string;
  /** Full address. */
  address?: string;
  /** Phone number. */
  phone?: string;
  /** Website URL. */
  website?: string;
  /** Domain extracted from website URL (e.g. "acme.com"). */
  domain?: string;
  /** Average rating (0–5). */
  rating?: number;
  /** Total number of reviews. */
  reviewsCount?: number;
  /** Primary category (e.g. "Restaurant", "Plumber"). */
  category?: string;
  /** All categories associated with the place. */
  categories: string[];
  /** City name. */
  city?: string;
  /** ISO country code (e.g. "US", "GB"). */
  countryCode?: string;
  /** Google place ID. */
  placeId?: string;
  /** Google Maps URL. */
  mapsUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the domain from a URL string, stripping "www." prefix.
 * Returns undefined if the URL is missing or unparseable.
 */
function extractDomain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = url.includes("://") ? new URL(url) : new URL(`https://${url}`);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Map raw Apify actor items into GoogleMapsResult[].
 */
function processResults(items: GoogleMapsRawItem[]): GoogleMapsResult[] {
  return items
    .filter((item) => item.title)
    .map((item) => ({
      name: item.title!,
      address: item.address,
      phone: item.phone,
      website: item.website,
      domain: extractDomain(item.website),
      rating: item.totalScore,
      reviewsCount: item.reviewsCount,
      category: item.categoryName,
      categories: item.categories ?? [],
      city: item.city,
      countryCode: item.countryCode,
      placeId: item.placeId,
      mapsUrl: item.url,
    }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search Google Maps for businesses matching a query and optional location.
 *
 * @param query - Search term (e.g. "umbrella companies", "Italian restaurant")
 * @param location - Optional location string (e.g. "London, UK", "New York, NY")
 * @param options - Optional overrides for maxResults and countryCode
 * @returns Array of GoogleMapsResult, one per place
 */
export async function searchGoogleMaps(
  query: string,
  location?: string,
  options?: { maxResults?: number; countryCode?: string },
): Promise<GoogleMapsResult[]> {
  const searchTerms = location ? `${query} ${location}` : query;

  const input: Record<string, unknown> = {
    searchStringsArray: [searchTerms],
    maxCrawledPlacesPerSearch: options?.maxResults ?? 20,
    language: "en",
  };

  if (options?.countryCode) {
    input.countryCode = options.countryCode.toLowerCase();
  }

  const items = await runApifyActor<GoogleMapsRawItem>(ACTOR_ID, input, {
    timeoutSecs: 120,
  });

  return processResults(items);
}
