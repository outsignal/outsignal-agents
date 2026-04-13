/**
 * Crawl cache — caches homepage scrapes on the Company record.
 * Cascade: free fetch → LinkedIn company page → Firecrawl (last resort, costs credits).
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
    console.log(`[crawl-cache] ${domain}: free fetch failed`);
  }

  // --- LinkedIn company page fallback (free, no credits) ---
  if (!markdown) {
    markdown = await tryLinkedInCompanyFallback(domain, company);
  }

  // --- Firecrawl as last resort (costs credits) ---
  if (!markdown && process.env.FIRECRAWL_API_KEY) {
    console.log(`[crawl-cache] ${domain}: trying Firecrawl (last resort)`);
    try {
      const result = await scrapeUrl(`https://${domain}`);
      markdown = result.markdown.slice(0, MAX_MARKDOWN_LENGTH);
    } catch (firecrawlErr) {
      console.error(`[crawl-cache] ${domain}: Firecrawl also failed:`, firecrawlErr);
    }
  }

  if (!markdown) {
    return null;
  }

  // Sanitise: strip null bytes (0x00) and other control chars that PostgreSQL
  // UTF-8 text columns reject with error 22021. Some crawled websites return
  // binary content, corrupted HTML, or PDF-served pages whose extracted text
  // contains literal \0 characters. Writing those to Company.crawlMarkdown
  // crashes the whole scoring run for the affected batch. Strip them here
  // once, so both the update and upsert paths below are safe.
  //
  // Strips: NUL (0x00), plus other C0 control chars except tab/newline/CR
  // which are legitimate whitespace and safe for Postgres text columns.
  markdown = markdown.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

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
 * Derive a LinkedIn company URL slug from a domain or company name.
 * Examples: "acme.com" -> "acme", "Widget Inc" -> "widget-inc"
 */
function deriveLinkedInSlug(domain: string, companyName?: string | null): string {
  // Prefer company name if it's more descriptive than the domain
  const base = companyName && companyName !== domain
    ? companyName
    : domain.replace(/\.(com|co\.uk|io|ai|org|net|co|app|dev)$/i, '');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Try fetching the LinkedIn company page as a fallback when website crawl fails.
 * Uses a browser-like User-Agent. Returns extracted text or null on failure.
 */
async function tryLinkedInCompanyFallback(
  domain: string,
  company: { name: string; linkedinUrl?: string | null } | null,
): Promise<string | null> {
  // Determine LinkedIn URL: use stored linkedinUrl, or construct from slug
  let linkedinUrl = company?.linkedinUrl ?? null;
  if (!linkedinUrl) {
    const slug = deriveLinkedInSlug(domain, company?.name);
    if (!slug) return null;
    linkedinUrl = `https://www.linkedin.com/company/${slug}`;
  }

  // Normalise: ensure it's the /about page for richer content
  const aboutUrl = linkedinUrl.replace(/\/+$/, '') + '/about';

  console.log(`[crawl-cache] ${domain}: trying LinkedIn fallback: ${aboutUrl}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(aboutUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      if (!res.ok) {
        console.log(`[crawl-cache] ${domain}: LinkedIn fallback HTTP ${res.status}`);
        return null;
      }

      const html = await res.text();
      const text = htmlToText(html);

      // LinkedIn pages return minimal useful content when not logged in
      // but still include company description, industry, and size in meta tags
      // and structured data. Extract what we can.
      const enriched = extractLinkedInMeta(html, text);

      if (!enriched || enriched.length < 50) {
        console.log(`[crawl-cache] ${domain}: LinkedIn fallback returned too little content (${enriched?.length ?? 0} chars)`);
        return null;
      }

      const markdown = enriched.slice(0, MAX_MARKDOWN_LENGTH);
      console.log(`[crawl-cache] ${domain}: LinkedIn fallback OK (${markdown.length} chars)`);
      return markdown;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.log(`[crawl-cache] ${domain}: LinkedIn fallback failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Extract structured company info from LinkedIn HTML.
 * LinkedIn embeds useful metadata in og: tags, JSON-LD, and specific
 * HTML patterns even for unauthenticated views.
 */
function extractLinkedInMeta(html: string, plainText: string): string {
  const parts: string[] = [];

  // Extract og:title (company name)
  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1]
    ?? html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:title"/i)?.[1];
  if (ogTitle) parts.push(`Company: ${decodeEntities(ogTitle)}`);

  // Extract og:description or meta description
  const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1]
    ?? html.match(/<meta[^>]*content="([^"]+)"[^>]*property="og:description"/i)?.[1]
    ?? html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i)?.[1]
    ?? html.match(/<meta[^>]*content="([^"]+)"[^>]*name="description"/i)?.[1];
  if (ogDesc) parts.push(`Description: ${decodeEntities(ogDesc)}`);

  // Extract JSON-LD structured data (LinkedIn often includes Organization schema)
  const jsonLdMatches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1]);
      const org = Array.isArray(data)
        ? data.find((d: Record<string, unknown>) => d['@type'] === 'Organization')
        : data['@type'] === 'Organization' ? data : null;
      if (org) {
        if (org.description) parts.push(`About: ${org.description}`);
        if (org.numberOfEmployees?.value) parts.push(`Employees: ${org.numberOfEmployees.value}`);
        if (org.industry) parts.push(`Industry: ${org.industry}`);
        if (org.address?.addressLocality) parts.push(`Location: ${org.address.addressLocality}`);
        if (org.url) parts.push(`Website: ${org.url}`);
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  }

  // Add the plain text body (filtered) as additional context
  // Filter out LinkedIn boilerplate (sign-in prompts, cookie notices, etc.)
  const filteredText = plainText
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (trimmed.length < 10) return false;
      // Filter LinkedIn boilerplate
      if (/sign in|sign up|join now|forgot password|cookie|privacy policy|user agreement/i.test(trimmed)) return false;
      if (/agree to linkedin|by clicking/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();

  if (filteredText.length > 100) {
    parts.push(`\n--- Page Content ---\n${filteredText}`);
  }

  return parts.join('\n');
}

/** Decode basic HTML entities. */
function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
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
