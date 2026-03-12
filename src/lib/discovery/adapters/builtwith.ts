/**
 * Technology stack detection adapter.
 *
 * Company-level signal checker — NOT a DiscoveryAdapter (domain-based, not filter-based).
 * Uses the Apify actor `automation-lab/tech-stack-detector` to detect technologies
 * on websites independently (no BuiltWith dependency). Detects 100+ technologies
 * with categories and confidence levels.
 *
 * Primary use case: tech qualification — e.g. finding Shopify stores for BlankTag,
 * checking if prospects use specific CMS/frameworks/analytics tools.
 *
 * Cost: ~$0.002 per URL checked (Apify compute).
 */

import { runApifyActor } from "@/lib/apify/client";

const ACTOR_ID = "automation-lab/tech-stack-detector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw item returned by the Apify actor (one per URL). */
interface TechStackRawItem {
  url?: string;
  technologies?: Array<{
    name?: string;
    category?: string;
    confidence?: string | number;
  }>;
}

/** A single detected technology on a domain. */
export interface DetectedTechnology {
  name: string;
  category?: string;
  description?: string;
}

/** Aggregated result for a single domain. */
export interface TechStackResult {
  domain: string;
  /** All technologies detected on the domain. */
  technologies: DetectedTechnology[];
  /** Number of technologies detected. */
  techCount: number;
  /** Technologies from filterTechnologies that were found on this domain. */
  matchedTechnologies: string[];
  /** Whether any of the filterTechnologies were found. */
  hasMatch: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a domain from raw actor output.
 * The actor may return a full URL or just a domain — extract the hostname.
 */
function extractDomain(raw: string): string {
  try {
    if (raw.includes("://")) {
      return new URL(raw).hostname.replace(/^www\./, "");
    }
    return raw.replace(/^www\./, "").toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/**
 * Process raw actor items into TechStackResult[], filtering against
 * optional technology names.
 */
function processResults(
  items: TechStackRawItem[],
  requestedDomains: string[],
  filterTechnologies?: string[],
): TechStackResult[] {
  const resultMap = new Map<string, TechStackResult>();

  // Seed every requested domain so we report empty results for domains with no data.
  for (const d of requestedDomains) {
    const key = d.toLowerCase();
    resultMap.set(key, {
      domain: key,
      technologies: [],
      techCount: 0,
      matchedTechnologies: [],
      hasMatch: false,
    });
  }

  // Normalise filter list for case-insensitive matching.
  const filterSet = filterTechnologies
    ? new Set(filterTechnologies.map((t) => t.toLowerCase()))
    : null;

  for (const item of items) {
    const rawDomain = item.url ?? "";
    if (!rawDomain) continue;

    const key = extractDomain(rawDomain);
    const techs: DetectedTechnology[] = (item.technologies ?? [])
      .filter((t) => t.name)
      .map((t) => ({
        name: t.name!,
        category: t.category,
      }));

    const matched = filterSet
      ? techs
          .filter((t) => filterSet.has(t.name.toLowerCase()))
          .map((t) => t.name)
      : [];

    resultMap.set(key, {
      domain: key,
      technologies: techs,
      techCount: techs.length,
      matchedTechnologies: matched,
      hasMatch: matched.length > 0,
    });
  }

  return Array.from(resultMap.values());
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check the technology stack for a list of domains via tech-stack-detector.
 *
 * Optionally pass `filterTechnologies` to flag domains that use specific
 * technologies (e.g. ['Shopify', 'WooCommerce', 'Magento']).
 *
 * @param domains - List of domains to check (e.g. ['acme.com', 'example.co.uk'])
 * @param filterTechnologies - Optional list of technology names to match against
 * @returns Array of TechStackResult, one per domain
 */
export async function checkTechStack(
  domains: string[],
  filterTechnologies?: string[],
): Promise<TechStackResult[]> {
  if (domains.length === 0) return [];

  // Actor expects full URLs, not bare domains.
  const urls = domains.map((d) =>
    `https://${d.toLowerCase().replace(/^https?:\/\//, "")}`,
  );

  const items = await runApifyActor<TechStackRawItem>(ACTOR_ID, {
    urls,
  });

  return processResults(items, domains, filterTechnologies);
}
