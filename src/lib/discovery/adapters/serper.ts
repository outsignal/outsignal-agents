/**
 * Serper.dev discovery adapter.
 *
 * Multi-method adapter for Google search results. Does NOT implement DiscoveryAdapter
 * (Serper is query-based, not filter-based). Exports a `serperAdapter` object with
 * three search methods:
 *
 *   - searchWeb: Google web results (organic listings)
 *   - searchMaps: Google Maps places (company-level records, no person fields)
 *   - searchSocial: Reddit/Twitter mentions (signal data — NOT staged to DiscoveredPerson)
 *
 * Maps results use discoverySource: "serper-maps" when staged via the agent tool
 * in Plan 03. Social results are returned raw for Phase 18 SignalEvent creation.
 *
 * Cost: $0.001 per call (1 Serper credit).
 * Rate limit: Serper allows ~50 concurrent requests. This adapter throws { status: 429 }
 * on rate limit for upstream retry handling.
 */

const SERPER_ENDPOINT = "https://google.serper.dev/search";
const REQUEST_TIMEOUT_MS = 10_000;

function getApiKey(): string {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    throw new Error("SERPER_API_KEY environment variable is not set");
  }
  return key;
}

// ---------------------------------------------------------------------------
// Exported result types
// ---------------------------------------------------------------------------

export interface SerperWebResult {
  /** Page title */
  title: string;
  /** Full URL */
  link: string;
  /** Search result snippet / description */
  snippet: string;
  /** 1-based position in results */
  position: number;
}

export interface SerperMapsResult {
  /** Place / business name */
  company: string;
  /** Full address string */
  address?: string;
  /** Phone number */
  phone?: string;
  /** Website URL */
  website?: string;
  /** Domain extracted from website (e.g. "acme.com") */
  companyDomain?: string;
  /** Google star rating (0–5) */
  rating?: number;
  /** Number of ratings / reviews */
  ratingCount?: number;
  /** Google Maps CID (unique place identifier) */
  cid?: string;
}

// ---------------------------------------------------------------------------
// Shared HTTP helper
// ---------------------------------------------------------------------------

/**
 * POST to Serper API with auth, timeout, and error handling.
 * Throws on non-200. Throws { status: 429 } on rate limit.
 */
async function serperPost(body: Record<string, unknown>): Promise<unknown> {
  const apiKey = getApiKey();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let raw: unknown;

  try {
    const response = await fetch(SERPER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 429) {
      throw Object.assign(new Error("Serper rate limit exceeded"), { status: 429 });
    }

    if (!response.ok) {
      throw Object.assign(
        new Error(`Serper API error: HTTP ${response.status}`),
        { status: response.status },
      );
    }

    raw = await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Domain extraction helper
// ---------------------------------------------------------------------------

/**
 * Extract bare domain from a website URL.
 * Returns undefined if URL is invalid or empty.
 * Example: "https://www.acme.com/about" → "acme.com"
 */
function extractDomain(website: string | undefined): string | undefined {
  if (!website) return undefined;
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Serper adapter methods
// ---------------------------------------------------------------------------

/**
 * Search Google web results for a query.
 * Returns organic search results with title, URL, snippet, and position.
 */
async function searchWeb(
  query: string,
  num?: number,
): Promise<{ results: SerperWebResult[]; costUsd: number; rawResponse: unknown }> {
  const raw = await serperPost({ q: query, type: "search", num: num ?? 10 });

  const organic = (raw as Record<string, unknown>)?.organic;
  const items = Array.isArray(organic) ? organic : [];

  const results: SerperWebResult[] = items.map((item: Record<string, unknown>, idx: number) => ({
    title: String(item.title ?? ""),
    link: String(item.link ?? ""),
    snippet: String(item.snippet ?? ""),
    position: typeof item.position === "number" ? item.position : idx + 1,
  }));

  return { results, costUsd: 0.001, rawResponse: raw };
}

/**
 * Search Google Maps places for a query.
 * Returns company-level records (no person fields). When staged via the agent
 * tool in Plan 03, these use discoverySource: "serper-maps".
 *
 * Maps result fields map to DiscoveredPersonResult as:
 *   company   ← place title
 *   phone     ← place phone
 *   companyDomain ← extracted from place website
 *   location  ← place address
 *   firstName, lastName, email, jobTitle are all undefined (company-level)
 */
async function searchMaps(
  query: string,
): Promise<{ results: SerperMapsResult[]; costUsd: number; rawResponse: unknown }> {
  const raw = await serperPost({ q: query, type: "places" });

  const places = (raw as Record<string, unknown>)?.places;
  const items = Array.isArray(places) ? places : [];

  const results: SerperMapsResult[] = items.map((item: Record<string, unknown>) => {
    const website = typeof item.website === "string" ? item.website : undefined;
    return {
      company: String(item.title ?? ""),
      address: typeof item.address === "string" ? item.address : undefined,
      phone: typeof item.phoneNumber === "string" ? item.phoneNumber : undefined,
      website,
      companyDomain: extractDomain(website),
      rating: typeof item.rating === "number" ? item.rating : undefined,
      ratingCount: typeof item.ratingCount === "number" ? item.ratingCount : undefined,
      cid: typeof item.cid === "string" ? item.cid : undefined,
    };
  });

  return { results, costUsd: 0.001, rawResponse: raw };
}

/**
 * Search Reddit or Twitter for social mentions of a query.
 *
 * NOTE: Social results are NOT staged to DiscoveredPerson. Per design, social
 * mentions are signal data, not contact records. The agent returns raw results
 * to the orchestrator; Phase 18 handles SignalEvent creation from these.
 */
async function searchSocial(
  query: string,
  platform?: "reddit" | "twitter",
): Promise<{ results: SerperWebResult[]; costUsd: number; rawResponse: unknown }> {
  const siteMap = {
    reddit: "site:reddit.com",
    twitter: "site:twitter.com",
  } as const;

  const sitePrefix = siteMap[platform ?? "reddit"];
  const fullQuery = `${sitePrefix} ${query}`;

  const raw = await serperPost({ q: fullQuery, type: "search", num: 10 });

  const organic = (raw as Record<string, unknown>)?.organic;
  const items = Array.isArray(organic) ? organic : [];

  const results: SerperWebResult[] = items.map((item: Record<string, unknown>, idx: number) => ({
    title: String(item.title ?? ""),
    link: String(item.link ?? ""),
    snippet: String(item.snippet ?? ""),
    position: typeof item.position === "number" ? item.position : idx + 1,
  }));

  return { results, costUsd: 0.001, rawResponse: raw };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Serper discovery adapter — const object, not a class.
 * Does not implement DiscoveryAdapter (query-based, not filter-based).
 */
export const serperAdapter = {
  searchWeb,
  searchMaps,
  searchSocial,
} as const;
