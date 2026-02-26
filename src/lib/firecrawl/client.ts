import Firecrawl from "@mendable/firecrawl-js";

export interface CrawlResult {
  url: string;
  markdown: string;
  title?: string;
}

export interface ScrapeResult {
  url: string;
  markdown: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

function getClient(): Firecrawl {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY environment variable is not set");
  }
  return new Firecrawl({ apiKey });
}

/**
 * Deep crawl a website, returning markdown content for each page found.
 * Crawls up to `maxPages` pages (default 10) starting from the given URL.
 */
export async function crawlWebsite(
  url: string,
  options?: { maxPages?: number },
): Promise<CrawlResult[]> {
  const client = getClient();
  const maxPages = options?.maxPages ?? 10;

  const job = await client.crawl(url, {
    limit: maxPages,
    scrapeOptions: {
      formats: ["markdown"],
    },
  });

  return (job.data ?? []).map((page) => ({
    url: page.metadata?.url ?? url,
    markdown: page.markdown ?? "",
    title: page.metadata?.title ?? undefined,
  }));
}

/**
 * Scrape a single URL and return its content as markdown.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const client = getClient();

  const result = await client.scrape(url, {
    formats: ["markdown"],
  });

  return {
    url,
    markdown: result.markdown ?? "",
    title: result.metadata?.title ?? undefined,
    metadata: result.metadata as Record<string, unknown> | undefined,
  };
}
