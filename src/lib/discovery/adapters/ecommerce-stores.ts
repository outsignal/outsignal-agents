/**
 * Ecommerce Store Leads adapter.
 *
 * Company-level discovery tool — searches a 14M+ ecommerce store database
 * using the Apify actor `ecommerce_leads/store-leads-14m-e-commerce-leads`.
 *
 * Primary use case: finding Shopify/WooCommerce/BigCommerce stores by
 * category, country, platform, and traffic — e.g. discovering ecommerce
 * brands for BlankTag's paid media pipeline.
 *
 * Cost: ~$0.0039 per lead (pay-per-result).
 */

import { runApifyActor } from "@/lib/apify/client";

const ACTOR_ID = "ecommerce_leads/store-leads-14m-e-commerce-leads";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw item returned by the Apify actor (one per store). */
interface EcommerceStoreRawItem {
  domain?: string;
  storeName?: string;
  name?: string;
  platform?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  monthlyVisits?: number;
  monthly_visits?: number;
  technologies?: string[];
  apps?: string[];
  categories?: string[];
  category?: string;
  socialLinks?: Record<string, string>;
  social_links?: Record<string, string>;
  facebook?: string;
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  employeeCount?: number;
  employee_count?: number;
  url?: string;
  storeUrl?: string;
  store_url?: string;
}

/** Processed result for a single ecommerce store. */
export interface EcommerceStoreResult {
  /** Store domain (e.g. "acme-store.com"). */
  domain: string;
  /** Store / brand name. */
  storeName?: string;
  /** Ecommerce platform (e.g. "Shopify", "WooCommerce", "BigCommerce"). */
  platform?: string;
  /** Contact email. */
  email?: string;
  /** Contact phone number. */
  phone?: string;
  /** Country name or ISO code. */
  country?: string;
  /** City name. */
  city?: string;
  /** Estimated monthly website visits. */
  monthlyVisits?: number;
  /** Technologies / apps used on the store. */
  technologies: string[];
  /** Store categories (e.g. "Apparel", "Electronics"). */
  categories: string[];
  /** Social media links keyed by platform name. */
  socialLinks: Record<string, string>;
  /** Estimated employee count. */
  employeeCount?: number;
}

/** Options for searchEcommerceStores. */
export interface EcommerceStoreSearchOptions {
  /** Ecommerce platform filter (e.g. "shopify", "woocommerce"). */
  platform?: string;
  /** Store category filter (e.g. "Apparel", "Electronics"). */
  category?: string;
  /** Country filter (e.g. "US", "United States", "GB"). */
  country?: string;
  /** Minimum monthly website visits. */
  minMonthlyVisits?: number;
  /** Maximum number of results to return (default: 50). */
  maxResults?: number;
  /** Keyword filters (matched against store name/category/technologies). */
  keywords?: string[];
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
 * Build social links object from raw item fields.
 */
function buildSocialLinks(item: EcommerceStoreRawItem): Record<string, string> {
  // Prefer structured socialLinks / social_links object, fall back to individual fields.
  const links: Record<string, string> = {};

  const raw = item.socialLinks ?? item.social_links;
  if (raw && typeof raw === "object") {
    for (const [key, val] of Object.entries(raw)) {
      if (val) links[key] = val;
    }
  }

  if (item.facebook && !links.facebook) links.facebook = item.facebook;
  if (item.instagram && !links.instagram) links.instagram = item.instagram;
  if (item.twitter && !links.twitter) links.twitter = item.twitter;
  if (item.linkedin && !links.linkedin) links.linkedin = item.linkedin;

  return links;
}

/**
 * Map raw Apify actor items into EcommerceStoreResult[].
 */
function processResults(items: EcommerceStoreRawItem[]): EcommerceStoreResult[] {
  const results: EcommerceStoreResult[] = [];

  for (const item of items) {
    const domain =
      item.domain ??
      extractDomain(item.url ?? item.storeUrl ?? item.store_url);
    if (!domain) continue;

    const categories: string[] = item.categories ?? [];
    if (item.category && !categories.includes(item.category)) {
      categories.unshift(item.category);
    }

    results.push({
      domain,
      storeName: item.storeName ?? item.name,
      platform: item.platform,
      email: item.email,
      phone: item.phone,
      country: item.country,
      city: item.city,
      monthlyVisits: item.monthlyVisits ?? item.monthly_visits,
      technologies: [
        ...new Set([...(item.technologies ?? []), ...(item.apps ?? [])]),
      ],
      categories,
      socialLinks: buildSocialLinks(item),
      employeeCount: item.employeeCount ?? item.employee_count,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Search the 14M ecommerce store database for stores matching the given
 * filters. Returns store-level data including domain, platform, email,
 * traffic, technologies, and social links.
 *
 * @param options - Search filters (platform, category, country, traffic, keywords)
 * @returns Array of EcommerceStoreResult, one per store
 */
export async function searchEcommerceStores(
  options: EcommerceStoreSearchOptions = {},
): Promise<EcommerceStoreResult[]> {
  const maxResults = options.maxResults ?? 50;

  const input: Record<string, unknown> = {
    maxItems: maxResults,
  };

  if (options.platform) {
    input.platform = options.platform.toLowerCase();
  }

  if (options.category) {
    input.category = options.category;
  }

  if (options.country) {
    input.country = options.country;
  }

  if (options.minMonthlyVisits) {
    input.minMonthlyVisits = options.minMonthlyVisits;
  }

  if (options.keywords && options.keywords.length > 0) {
    input.keywords = options.keywords.join(",");
  }

  const items = await runApifyActor<EcommerceStoreRawItem>(ACTOR_ID, input, {
    timeoutSecs: 120,
  });

  return processResults(items);
}
