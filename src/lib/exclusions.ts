/**
 * Exclusion list utilities.
 *
 * Provides O(1) domain lookups against workspace exclusion lists, with a
 * 5-minute in-memory cache to avoid repeated DB queries during batch operations
 * (e.g. promotion loops processing hundreds of DiscoveredPerson records).
 *
 * Used by:
 *   - Discovery promotion (src/lib/discovery/promotion.ts)
 *   - Enrichment queue (src/lib/enrichment/queue.ts)
 *   - Target list addition (src/lib/leads/operations.ts)
 *   - CLI exclusion upload (scripts/cli/exclusion-upload.ts)
 */

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Domain normalisation
// ---------------------------------------------------------------------------

/**
 * Normalize a domain string: lowercase, strip protocol, www prefix,
 * trailing slashes, and paths. Returns null if the result is invalid
 * (no dot present).
 */
export function normalizeDomain(raw: string): string | null {
  let d = raw.trim().toLowerCase();

  // Strip protocol
  d = d.replace(/^https?:\/\//, "");

  // Strip www. prefix
  d = d.replace(/^www\./, "");

  // Strip trailing slash and anything after
  const slashIdx = d.indexOf("/");
  if (slashIdx !== -1) {
    d = d.substring(0, slashIdx);
  }

  // Strip port
  const colonIdx = d.indexOf(":");
  if (colonIdx !== -1) {
    d = d.substring(0, colonIdx);
  }

  // Trim again (whitespace after stripping)
  d = d.trim();

  // Must contain a dot to be a valid domain
  if (!d.includes(".")) return null;

  // Must not be empty
  if (d.length === 0) return null;

  return d;
}

/**
 * Extract the domain part from an email address.
 * Returns null if the input is not a valid email shape.
 */
export function extractDomain(email: string): string | null {
  const atIdx = email.lastIndexOf("@");
  if (atIdx === -1 || atIdx === email.length - 1) return null;
  const domain = email.substring(atIdx + 1).toLowerCase().trim();
  if (!domain.includes(".")) return null;
  return domain;
}

// ---------------------------------------------------------------------------
// Cached domain lookups
// ---------------------------------------------------------------------------

interface CacheEntry {
  domains: Set<string>;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();

/**
 * Load exclusion domains for a workspace as a Set for O(1) lookups.
 * Results are cached for 5 minutes to avoid repeated DB queries during
 * batch operations.
 */
export async function getExclusionDomains(
  workspaceSlug: string,
): Promise<Set<string>> {
  const now = Date.now();
  const cached = cache.get(workspaceSlug);
  if (cached && cached.expiresAt > now) {
    return cached.domains;
  }

  const entries = await prisma.exclusionEntry.findMany({
    where: { workspaceSlug },
    select: { domain: true },
  });

  const domains = new Set(entries.map((e) => e.domain));

  cache.set(workspaceSlug, {
    domains,
    expiresAt: now + CACHE_TTL_MS,
  });

  return domains;
}

/**
 * Check if a domain is excluded for a workspace.
 * Normalizes the input domain before checking.
 */
export async function isExcluded(
  workspaceSlug: string,
  domain: string,
): Promise<boolean> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;

  const excludedDomains = await getExclusionDomains(workspaceSlug);
  return excludedDomains.has(normalized);
}

/**
 * Invalidate the cached exclusion domains for a workspace.
 * Called after uploading new exclusions so subsequent checks see the update.
 */
export function invalidateCache(workspaceSlug: string): void {
  cache.delete(workspaceSlug);
}
