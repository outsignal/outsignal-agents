/**
 * Crawl cache — caches Firecrawl homepage scrapes on the Company record.
 * Checks Company.crawledAt before calling Firecrawl. Cache is permanent
 * (no TTL) — use force_recrawl parameter to refresh.
 */
import { prisma } from "@/lib/db";
import { scrapeUrl } from "@/lib/firecrawl/client";

const MAX_MARKDOWN_LENGTH = 50_000;

/**
 * Get cached homepage markdown for a domain, or scrape it via Firecrawl if not cached.
 *
 * @param domain - e.g. "acme.com" (no protocol)
 * @param forceRecrawl - set true to bypass the cache and re-scrape
 * @returns homepage markdown (truncated to 50k chars), or null on error
 */
export async function getCrawlMarkdown(
  domain: string,
  forceRecrawl?: boolean,
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
