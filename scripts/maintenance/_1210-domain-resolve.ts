/**
 * 1210 Transport Domain Resolution — Phase 1
 *
 * Resolves domains for ~6,917 aprSlice companies using the hardened Serper path.
 * Pipeline: DB cache check → contextual Serper candidate search → HTTP verify →
 * Company upsert → Person.companyDomain update.
 *
 * Query strategy is delegated to the shared resolver path:
 * quoted company name + 1210 transport context keywords, with optional city retry,
 * plus Serper geo/language bias (gl=uk, hl=en-GB).
 *
 * Budget: variable based on shared retry planning (up to 2 Serper queries/company).
 * Concurrency: 10 concurrent Serper calls
 *
 * Usage: npx tsx scripts/maintenance/_1210-domain-resolve.ts [--dry-run] [--limit N]
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import { serperAdapter } from "@/lib/discovery/adapters/serper";
import { verifyDomainLive } from "@/lib/discovery/domain-resolver";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : Infinity;
const CONCURRENCY = 10;
const BATCH_LOG_SIZE = 100;
const DOMAIN_CONTEXT_KEYWORDS = ["haulage", "logistics", "transport", "freight"] as const;
const SERPER_GEO = "uk";
const SERPER_LANGUAGE = "en-GB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompanyToResolve {
  companyName: string;
  companyRegNumber?: number;
  fleetBand: string;
  subCampaign: string;
  city: string | null;
  personIds: string[];
}

interface ResolutionResult {
  companyName: string;
  domain: string | null;
  source: "db" | "serper" | "serper-fallback" | "failed";
  fleetBand: string;
  subCampaign: string;
  personCount: number;
}

// ---------------------------------------------------------------------------
// Semaphore for concurrency control
// ---------------------------------------------------------------------------

class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.running < this.max) { this.running++; return; }
    return new Promise<void>(resolve => {
      this.queue.push(() => { this.running++; resolve(); });
    });
  }
  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// City extraction from OLBS correspondenceAddress
// ---------------------------------------------------------------------------

/**
 * Extract city/town from OLBS correspondence address.
 * Format: "... STREET CITY ... GB POSTCODE"
 * Heuristic: split on double+ spaces, take last non-unit segment before GB.
 */
function extractCity(address: string | undefined): string | null {
  if (!address) return null;
  // Strip "GB POSTCODE" suffix
  const stripped = address.replace(/\s+GB\s+[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\s*$/, "").trim();
  // Split on double+ whitespace (OLBS separator)
  const parts = stripped.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // Skip unit/depot/office identifiers
  const unitPrefix = /^(UNIT|FLOOR|SUITE|DEPOT|YARD|PLOT|OFFICE|BLOCK|ROOM)\b/i;
  const candidates = parts.filter(p => !unitPrefix.test(p));
  const city = candidates[candidates.length - 1];
  if (!city || city.length < 3) return null;
  // Title-case
  return city.split(" ").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`=== 1210 Transport Domain Resolution ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Limit: ${LIMIT === Infinity ? "none" : LIMIT}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log();

  // -----------------------------------------------------------------------
  // STAGE 1: Pull distinct companies needing resolution
  // -----------------------------------------------------------------------
  console.log("STAGE 1: Identifying companies to resolve...");

  const persons = await prisma.person.findMany({
    where: {
      enrichmentData: { contains: '"aprSlice":true' },
      companyDomain: null,
    },
    select: { id: true, company: true, enrichmentData: true },
  });

  // Group by company name
  const companyMap = new Map<string, CompanyToResolve>();
  for (const p of persons) {
    const name = p.company;
    if (!name) continue;
    const ed = JSON.parse(p.enrichmentData || "{}");
    const key = name.toUpperCase().trim();
    if (!companyMap.has(key)) {
      companyMap.set(key, {
        companyName: name,
        companyRegNumber: ed.companyRegNumber,
        fleetBand: ed.fleetBand || "unknown",
        subCampaign: ed.subCampaign || "unknown",
        city: extractCity(ed.correspondenceAddress),
        personIds: [],
      });
    }
    companyMap.get(key)!.personIds.push(p.id);
  }

  const companies = Array.from(companyMap.values());
  const toProcess = companies.slice(0, LIMIT);

  console.log(`  Total persons: ${persons.length}`);
  console.log(`  Distinct companies: ${companies.length}`);
  console.log(`  Processing: ${toProcess.length}`);

  // Fleet band breakdown
  const fleetBreakdown: Record<string, number> = {};
  const subCampaignBreakdown: Record<string, number> = {};
  for (const c of toProcess) {
    fleetBreakdown[c.fleetBand] = (fleetBreakdown[c.fleetBand] || 0) + 1;
    subCampaignBreakdown[c.subCampaign] = (subCampaignBreakdown[c.subCampaign] || 0) + 1;
  }
  console.log(`  Fleet bands: ${JSON.stringify(fleetBreakdown)}`);
  console.log(`  Sub-campaigns: ${JSON.stringify(subCampaignBreakdown)}`);
  console.log();

  // -----------------------------------------------------------------------
  // STAGE 2: Run domain resolution
  // -----------------------------------------------------------------------
  console.log("STAGE 2: Running domain resolution...");

  const semaphore = new Semaphore(CONCURRENCY);
  const results: ResolutionResult[] = [];
  let serperQueries = 0;
  let fallbackQueries = 0;
  let dbHits = 0;
  let resolved = 0;
  let resolvedViaFallback = 0;
  let failed = 0;
  let verificationSkips = 0;
  let processedCount = 0;
  const startTime = Date.now();

  async function persistDomain(company: CompanyToResolve, domain: string): Promise<void> {
    await prisma.company.upsert({
      where: { domain },
      update: { name: company.companyName },
      create: { domain, name: company.companyName },
    });
    await prisma.person.updateMany({
      where: { id: { in: company.personIds } },
      data: { companyDomain: domain },
    });
  }

  async function resolveOne(company: CompanyToResolve): Promise<ResolutionResult> {
    await semaphore.acquire();
    try {
      // Step 1: DB cache check (case-insensitive)
      const existing = await prisma.company.findFirst({
        where: { name: { equals: company.companyName, mode: "insensitive" } },
        select: { domain: true },
      });

      if (existing) {
        dbHits++;
        if (!DRY_RUN) {
          await prisma.person.updateMany({
            where: { id: { in: company.personIds } },
            data: { companyDomain: existing.domain },
          });
        }
        return {
          companyName: company.companyName,
          domain: existing.domain,
          source: "db",
          fleetBand: company.fleetBand,
          subCampaign: company.subCampaign,
          personCount: company.personIds.length,
        };
      }

      if (DRY_RUN) {
        serperQueries++;
        return {
          companyName: company.companyName,
          domain: null,
          source: "failed",
          fleetBand: company.fleetBand,
          subCampaign: company.subCampaign,
          personCount: company.personIds.length,
        };
      }

      try {
        const searchResult = await serperAdapter.searchCompanyDomains({
          companyName: company.companyName,
          location: company.city ?? undefined,
          contextKeywords: [...DOMAIN_CONTEXT_KEYWORDS],
          gl: SERPER_GEO,
          hl: SERPER_LANGUAGE,
        });

        const attemptsUsed = searchResult.queries.length;
        serperQueries += attemptsUsed;
        fallbackQueries += Math.max(0, attemptsUsed - 1);

        for (const candidate of searchResult.candidates) {
          const isLive = await verifyDomainLive(candidate.domain);
          if (!isLive) {
            verificationSkips++;
            continue;
          }

          await persistDomain(company, candidate.domain);
          resolved++;
          if (candidate.attempt > 1) {
            resolvedViaFallback++;
          }

          return {
            companyName: company.companyName,
            domain: candidate.domain,
            source: candidate.attempt > 1 ? "serper-fallback" : "serper",
            fleetBand: company.fleetBand,
            subCampaign: company.subCampaign,
            personCount: company.personIds.length,
          };
        }
      } catch {
        // Search errors — fall through to failed
      }

      failed++;
      return {
        companyName: company.companyName,
        domain: null,
        source: "failed",
        fleetBand: company.fleetBand,
        subCampaign: company.subCampaign,
        personCount: company.personIds.length,
      };
    } finally {
      semaphore.release();
      processedCount++;
      if (processedCount % BATCH_LOG_SIZE === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (processedCount / ((Date.now() - startTime) / 1000)).toFixed(1);
        console.log(
          `  [${elapsed}s] ${processedCount}/${toProcess.length} processed | ` +
          `${resolved} resolved | ${failed} failed | ${dbHits} cached | ` +
          `${serperQueries} queries ($${(serperQueries * 0.001).toFixed(2)}) | ${rate}/s`
        );
      }
    }
  }

  // Process all companies with concurrency control
  const allSettled = await Promise.allSettled(
    toProcess.map(company => resolveOne(company))
  );

  for (const outcome of allSettled) {
    if (outcome.status === "fulfilled") {
      results.push(outcome.value);
    } else {
      console.error("Unexpected rejection:", outcome.reason);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const cost = (serperQueries * 0.001).toFixed(3);

  // -----------------------------------------------------------------------
  // STAGE 3: Report
  // -----------------------------------------------------------------------
  console.log();
  console.log("=== STAGE 3: REPORT ===");
  console.log();
  console.log(`A. Unique companies processed: ${toProcess.length}`);
  console.log(`B. Already cached (DB hit, skipped): ${dbHits}`);
  console.log(`C. Serper queries: ${serperQueries} (primary: ${serperQueries - fallbackQueries}, fallback: ${fallbackQueries}) | Cost: $${cost}`);
  console.log(`D. Successfully resolved: ${resolved} (primary: ${resolved - resolvedViaFallback}, fallback: ${resolvedViaFallback})`);
  console.log(`E. Failed (no domain found): ${failed}`);
  console.log(`F. Resolution rate: ${((resolved + dbHits) / toProcess.length * 100).toFixed(1)}%`);
  console.log();

  // Resolution rate by fleet band
  console.log("   Resolution rate by fleet band:");
  const bandStats: Record<string, { total: number; resolved: number }> = {};
  for (const r of results) {
    if (!bandStats[r.fleetBand]) bandStats[r.fleetBand] = { total: 0, resolved: 0 };
    bandStats[r.fleetBand].total++;
    if (r.domain) bandStats[r.fleetBand].resolved++;
  }
  for (const [band, s] of Object.entries(bandStats).sort()) {
    console.log(`     ${band}: ${s.resolved}/${s.total} (${(s.resolved / s.total * 100).toFixed(1)}%)`);
  }

  // Resolution rate by sub-campaign
  console.log("   Resolution rate by sub-campaign:");
  const scStats: Record<string, { total: number; resolved: number }> = {};
  for (const r of results) {
    if (!scStats[r.subCampaign]) scStats[r.subCampaign] = { total: 0, resolved: 0 };
    scStats[r.subCampaign].total++;
    if (r.domain) scStats[r.subCampaign].resolved++;
  }
  for (const [sc, s] of Object.entries(scStats).sort()) {
    console.log(`     ${sc}: ${s.resolved}/${s.total} (${(s.resolved / s.total * 100).toFixed(1)}%)`);
  }

  console.log();

  // Sample 10 resolved
  const resolvedResults = results.filter(r => r.domain !== null);
  console.log("G. Sample resolved (up to 10):");
  for (const r of resolvedResults.slice(0, 10)) {
    console.log(`   ${r.companyName} | fleet ${r.fleetBand} | ${r.domain} [${r.source}]`);
  }

  // Sample 5 failed
  const failedResults = results.filter(r => r.domain === null);
  console.log();
  console.log("   Sample failed (up to 5):");
  for (const r of failedResults.slice(0, 5)) {
    console.log(`   ${r.companyName} | fleet ${r.fleetBand}`);
  }

  console.log();
  console.log("H. Anomalies:");
  console.log(`   Verification skips after candidate scoring: ${verificationSkips}`);
  console.log(`   Elapsed: ${elapsed}s`);

  // Person coverage summary
  const personsResolved = results.filter(r => r.domain).reduce((sum, r) => sum + r.personCount, 0);
  const personsUnresolved = results.filter(r => !r.domain).reduce((sum, r) => sum + r.personCount, 0);
  console.log();
  console.log("Person coverage:");
  console.log(`   Persons with domain now: ${personsResolved}`);
  console.log(`   Persons still without domain: ${personsUnresolved}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
