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
import { EmailBisonClient } from "@/lib/emailbison/client";

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

// ---------------------------------------------------------------------------
// Bi-directional EmailBison blacklist sync
// ---------------------------------------------------------------------------

/**
 * Bi-directional sync between ExclusionEntry table and EmailBison blacklists.
 *
 * 1. Pull EB blacklisted domains -> upsert into ExclusionEntry (reason: "Synced from EmailBison blacklist")
 * 2. Push ExclusionEntry domains -> add to EB blacklist if missing
 */
export async function syncExclusionsWithEmailBison(
  workspaceSlug: string,
): Promise<{
  pulledFromEB: number;
  pushedToEB: number;
  alreadySynced: number;
}> {
  // Load workspace API token
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { apiToken: true },
  });

  if (!workspace?.apiToken) {
    console.log(`[exclusion-sync] Skipping ${workspaceSlug} — no API token`);
    return { pulledFromEB: 0, pushedToEB: 0, alreadySynced: 0 };
  }

  const client = new EmailBisonClient(workspace.apiToken);

  // 1. Pull EB blacklisted domains
  const ebDomains = await client.listBlacklistedDomains();
  const ebDomainSet = new Set(ebDomains.map((d) => d.domain.toLowerCase()));

  // 2. Load existing exclusion domains from DB
  const existingEntries = await prisma.exclusionEntry.findMany({
    where: { workspaceSlug },
    select: { domain: true },
  });
  const existingDomainSet = new Set(existingEntries.map((e) => e.domain));

  let pulledFromEB = 0;
  let pushedToEB = 0;
  let alreadySynced = 0;

  // Pull: EB -> ExclusionEntry
  for (const ebDomain of ebDomainSet) {
    const normalized = normalizeDomain(ebDomain);
    if (!normalized) continue;

    if (existingDomainSet.has(normalized)) {
      alreadySynced++;
      continue;
    }

    await prisma.exclusionEntry.upsert({
      where: {
        workspaceSlug_domain: { workspaceSlug, domain: normalized },
      },
      update: {},
      create: {
        workspaceSlug,
        domain: normalized,
        reason: "Synced from EmailBison blacklist",
      },
    });
    pulledFromEB++;
  }

  // Push: ExclusionEntry -> EB
  for (const domain of existingDomainSet) {
    if (ebDomainSet.has(domain)) continue;

    try {
      await client.blacklistDomain(domain);
      pushedToEB++;
    } catch (err) {
      // Log but don't fail the whole sync for a single domain
      console.warn(
        `[exclusion-sync] Failed to push domain ${domain} to EB for ${workspaceSlug}:`,
        err,
      );
    }
  }

  // Invalidate cache so subsequent lookups see newly pulled domains
  if (pulledFromEB > 0) {
    invalidateCache(workspaceSlug);
  }

  console.log(
    `[exclusion-sync] ${workspaceSlug}: pulled=${pulledFromEB}, pushed=${pushedToEB}, alreadySynced=${alreadySynced}`,
  );

  return { pulledFromEB, pushedToEB, alreadySynced };
}
