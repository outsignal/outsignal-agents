/**
 * domain-resolver.ts
 *
 * Company name to domain resolution with DB caching.
 * Pipeline: DB lookup -> Serper contextual search -> HTTP verification -> persist.
 *
 * Purpose: Enable green-list-style campaigns (like 1210's 104-company list) to
 * run without manual domain research. Each resolution is cached for future use.
 */

import { prisma } from "@/lib/db";
import { serperAdapter } from "./adapters/serper";

// ---------------------------------------------------------------------------
// Known parking service domains
// ---------------------------------------------------------------------------

const PARKING_DOMAINS = [
  "sedo.com",
  "godaddy.com",
  "afternic.com",
  "hugedomains.com",
  "dan.com",
  "namecheap.com",
  "bodis.com",
];

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface ResolutionResult {
  companyName: string;
  domain: string | null;
  source: "db" | "serper" | "failed";
  httpVerified: boolean;
}

export interface ResolutionSummary {
  total: number;
  resolved: number;
  failed: number;
  failedCompanies: string[];
  results: ResolutionResult[];
  totalCostUsd: number;
}

// ---------------------------------------------------------------------------
// Simple concurrency limiter (no external deps)
// ---------------------------------------------------------------------------

class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Verify that a domain resolves to a live website.
 * HTTP HEAD request with 5-second timeout.
 * Returns false for 4xx/5xx, timeout, network error, or redirect to parking service.
 */
export async function verifyDomainLive(domain: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`https://${domain}`, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    // Check for redirect to known parking services
    const finalUrl = response.url;
    if (finalUrl) {
      const finalHostname = new URL(finalUrl).hostname.toLowerCase();
      if (PARKING_DOMAINS.some((pd) => finalHostname.includes(pd))) {
        return false;
      }
    }

    return response.ok || (response.status >= 300 && response.status < 400);
  } catch {
    return false;
  }
}

/**
 * Extract domain from a URL, stripping "www." prefix.
 */
function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}

/**
 * Resolve a single company name to a domain using the 4-step pipeline:
 * 1. DB lookup (Company table)
 * 2. Serper contextual search with ICP context
 * 3. HTTP verification
 * 4. Persist to Company table
 */
export async function resolveCompanyDomain(
  companyName: string,
  icpContext: { location?: string; industry?: string },
): Promise<ResolutionResult & { costUsd: number }> {
  // Step 1: DB lookup
  const existing = await prisma.company.findFirst({
    where: { name: { contains: companyName, mode: "insensitive" } },
    select: { domain: true, name: true },
  });

  if (existing) {
    return {
      companyName,
      domain: existing.domain,
      source: "db",
      httpVerified: true, // already in DB = trusted
      costUsd: 0,
    };
  }

  // Step 2: Serper contextual search
  const contextParts = [companyName];
  if (icpContext.location) contextParts.push(icpContext.location);
  if (icpContext.industry) contextParts.push(icpContext.industry);
  const query = contextParts.join(" ") + " official website";

  let costUsd = 0;
  try {
    const { results, costUsd: searchCost } = await serperAdapter.searchWeb(query, 3);
    costUsd = searchCost;

    // Try top results
    for (const result of results) {
      const domain = extractDomain(result.link);
      if (!domain) continue;

      // Skip search engine / directory domains
      if (
        domain.includes("linkedin.com") ||
        domain.includes("facebook.com") ||
        domain.includes("twitter.com") ||
        domain.includes("wikipedia.org") ||
        domain.includes("yelp.com") ||
        domain.includes("crunchbase.com")
      ) {
        continue;
      }

      // Step 3: HTTP verification
      const isLive = await verifyDomainLive(domain);
      if (!isLive) continue;

      // Step 4: Persist to Company table
      await prisma.company.upsert({
        where: { domain },
        update: { name: companyName },
        create: { domain, name: companyName },
      });

      return {
        companyName,
        domain,
        source: "serper",
        httpVerified: true,
        costUsd,
      };
    }
  } catch {
    // Serper failed — fall through to failed result
  }

  return {
    companyName,
    domain: null,
    source: "failed",
    httpVerified: false,
    costUsd,
  };
}

/**
 * Batch resolve company names to domains with concurrency limit.
 * Uses Promise.allSettled with a semaphore for concurrency control.
 */
export async function resolveCompanyDomains(
  companies: string[],
  icpContext: { location?: string; industry?: string },
): Promise<ResolutionSummary> {
  const semaphore = new Semaphore(10);
  let totalCostUsd = 0;

  const settled = await Promise.allSettled(
    companies.map(async (company) => {
      await semaphore.acquire();
      try {
        const result = await resolveCompanyDomain(company, icpContext);
        totalCostUsd += result.costUsd;
        return {
          companyName: result.companyName,
          domain: result.domain,
          source: result.source,
          httpVerified: result.httpVerified,
        } as ResolutionResult;
      } finally {
        semaphore.release();
      }
    }),
  );

  const results: ResolutionResult[] = [];
  const failedCompanies: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
      if (outcome.value.source === "failed") {
        failedCompanies.push(companies[i]);
      }
    } else {
      // Promise rejected — treat as failure
      results.push({
        companyName: companies[i],
        domain: null,
        source: "failed",
        httpVerified: false,
      });
      failedCompanies.push(companies[i]);
    }
  }

  const resolved = results.filter((r) => r.domain !== null).length;

  return {
    total: companies.length,
    resolved,
    failed: companies.length - resolved,
    failedCompanies,
    results,
    totalCostUsd: Math.round(totalCostUsd * 1000) / 1000,
  };
}
