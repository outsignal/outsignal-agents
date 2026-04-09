/**
 * Crawl cache — caches Firecrawl homepage scrapes on the Company record.
 * Checks Company.crawledAt before calling Firecrawl. Cache is permanent
 * (no TTL) — use force_recrawl parameter to refresh.
 *
 * Includes in-memory inflight dedup to prevent duplicate Firecrawl calls
 * when multiple concurrent scorers request the same domain.
 */
import { prisma } from "@/lib/db";
import { scrapeUrl } from "@/lib/firecrawl/client";

const MAX_MARKDOWN_LENGTH = 50_000;

/**
 * In-memory map of domain -> pending crawl promise.
 * Prevents duplicate Firecrawl calls when concurrent scorers
 * request the same domain before the first call completes.
 * Process-scoped — no cross-process sharing needed.
 */
const inflight = new Map<string, Promise<string | null>>();

/**
 * Get cached homepage markdown for a domain, or scrape it via Firecrawl if not cached.
 * Uses in-memory dedup so concurrent calls for the same domain share one Firecrawl request.
 *
 * @param domain - e.g. "acme.com" (no protocol)
 * @param forceRecrawl - set true to bypass the cache and re-scrape
 * @returns homepage markdown (truncated to 50k chars), or null on error
 */
export async function getCrawlMarkdown(
  domain: string,
  forceRecrawl = false,
): Promise<string | null> {
  if (!forceRecrawl && inflight.has(domain)) {
    return inflight.get(domain)!;
  }

  const promise = getCrawlMarkdownInner(domain, forceRecrawl);
  if (!forceRecrawl) {
    inflight.set(domain, promise);
    promise.finally(() => inflight.delete(domain));
  }

  return promise;
}

/**
 * Inner implementation — checks DB cache, falls back to Firecrawl scrape.
 */
async function getCrawlMarkdownInner(
  domain: string,
  forceRecrawl: boolean,
): Promise<string | null> {
  // Check cache first
  const company = await prisma.company.findUnique({ where: { domain } });

  if (company?.crawledAt && !forceRecrawl) {
    // Cache hit — return stored markdown
    return company.crawlMarkdown ?? null;
  }

  // Cache miss or force refresh — scrape via Firecrawl
  try {
    const result = await scrapeUrl(`https://${domain}`);
    const markdown = result.markdown.slice(0, MAX_MARKDOWN_LENGTH);

    if (company) {
      // Company exists — update crawl fields
      await prisma.company.update({
        where: { domain },
        data: {
          crawlMarkdown: markdown,
          crawledAt: new Date(),
        },
      });
    } else {
      // Company doesn't exist — upsert (handles Pitfall 4: Company record may not exist yet)
      await prisma.company.upsert({
        where: { domain },
        create: {
          domain,
          name: domain,
          crawlMarkdown: markdown,
          crawledAt: new Date(),
        },
        update: {
          crawlMarkdown: markdown,
          crawledAt: new Date(),
        },
      });
    }

    return markdown;
  } catch (error) {
    console.error(`[crawl-cache] Failed to scrape ${domain}:`, error);
    return null;
  }
}

/**
 * Pre-crawl all unique domains before batch scoring begins.
 * Checks the DB cache first, then crawls uncached domains in parallel
 * with a concurrency limit to avoid hammering Firecrawl.
 *
 * @param domains - array of domain strings (may contain nulls/duplicates)
 * @returns summary of cached, crawled, and failed counts
 */
export async function prefetchDomains(
  domains: (string | null | undefined)[],
): Promise<{ cached: number; crawled: number; failed: number }> {
  // Deduplicate and filter out null/empty
  const unique = [...new Set(domains.filter((d): d is string => !!d?.trim()))];

  if (unique.length === 0) {
    return { cached: 0, crawled: 0, failed: 0 };
  }

  // Check which domains already have cached crawl data
  const companies = await prisma.company.findMany({
    where: {
      domain: { in: unique },
      crawledAt: { not: null },
      crawlMarkdown: { not: null },
    },
    select: { domain: true },
  });

  const cachedDomains = new Set(companies.map((c) => c.domain));
  const uncached = unique.filter((d) => !cachedDomains.has(d));

  let crawled = 0;
  let failed = 0;

  // Crawl uncached domains with concurrency limit of 5
  const CONCURRENCY = 5;
  const queue = [...uncached];
  let active = 0;
  let resolveAll: () => void;
  const allDone = new Promise<void>((r) => { resolveAll = r; });

  if (queue.length === 0) {
    return { cached: cachedDomains.size, crawled: 0, failed: 0 };
  }

  let idx = 0;

  function next() {
    while (active < CONCURRENCY && idx < queue.length) {
      const domain = queue[idx++];
      active++;
      getCrawlMarkdown(domain)
        .then((result) => {
          if (result !== null) crawled++;
          else failed++;
        })
        .catch(() => {
          failed++;
        })
        .finally(() => {
          active--;
          if (idx >= queue.length && active === 0) {
            resolveAll();
          } else {
            next();
          }
        });
    }
  }

  next();
  await allDone;

  return { cached: cachedDomains.size, crawled, failed };
}
