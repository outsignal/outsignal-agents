/**
 * Crawl cache — caches homepage scrapes on the Company record.
 * Tries a free fetch + HTML-to-text first, falls back to Firecrawl if available.
 * Checks Company.crawledAt before scraping. Cache is permanent
 * (no TTL) — use force_recrawl parameter to refresh.
 *
 * Includes in-memory inflight dedup to prevent duplicate scrape calls
 * when multiple concurrent scorers request the same domain.
 */
import { prisma } from "@/lib/db";
import { scrapeUrl } from "@/lib/firecrawl/client";

const MAX_MARKDOWN_LENGTH = 50_000;

/**
 * Convert raw HTML to readable plain text without external dependencies.
 * Strips scripts, styles, nav/header/footer, HTML tags, and collapses whitespace.
 */
function htmlToText(html: string): string {
  let text = html;
  // Remove script, style, nav, footer, header, noscript, svg blocks entirely
  text = text.replace(/<(script|style|nav|footer|header|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  // Replace block-closing tags with newlines
  text = text.replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

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
 * Inner implementation — checks DB cache, tries free fetch, falls back to Firecrawl.
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

  // --- Try free fetch first ---
  let markdown: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`https://${domain}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OutsignalBot/1.0)' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const text = htmlToText(html);
      markdown = text.slice(0, MAX_MARKDOWN_LENGTH);
      console.log(`[crawl-cache] ${domain}: free fetch OK (${markdown.length} chars)`);
    } finally {
      clearTimeout(timeout);
    }
  } catch (fetchErr) {
    // --- Fall back to Firecrawl if available ---
    if (process.env.FIRECRAWL_API_KEY) {
      console.log(`[crawl-cache] ${domain}: free fetch failed, trying Firecrawl`);
      try {
        const result = await scrapeUrl(`https://${domain}`);
        markdown = result.markdown.slice(0, MAX_MARKDOWN_LENGTH);
      } catch (firecrawlErr) {
        console.error(`[crawl-cache] ${domain}: Firecrawl also failed:`, firecrawlErr);
      }
    } else {
      console.log(`[crawl-cache] ${domain}: free fetch failed, no Firecrawl key`);
    }
  }

  if (!markdown) {
    return null;
  }

  // Store result in Company model
  if (company) {
    await prisma.company.update({
      where: { domain },
      data: {
        crawlMarkdown: markdown,
        crawledAt: new Date(),
      },
    });
  } else {
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
