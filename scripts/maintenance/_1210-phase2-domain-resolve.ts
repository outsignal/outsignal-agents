/**
 * 1210 Transport Phase 2 — Task 3: Domain resolution for new top-ups
 *
 * Targets: aprSlice=true AND companyDomain IS NULL AND Standard licence
 * These are the ~1,907 persons added in Task 2 who don't yet have a resolved domain.
 * (Some may already have domains from Phase 1 resolution.)
 *
 * Uses the same hardened Serper pipeline as _1210-domain-resolve.ts:
 *   DB cache check → contextual Serper candidate search → HTTP verify →
 *   Company upsert → Person.companyDomain update.
 *
 * Budget: variable based on shared retry planning (up to 2 Serper queries/company).
 * Concurrency: 10
 *
 * Usage: npx tsx scripts/maintenance/_1210-phase2-domain-resolve.ts [--dry-run] [--limit N]
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import { serperAdapter } from "@/lib/discovery/adapters/serper";
import { verifyDomainLive } from "@/lib/discovery/domain-resolver";

const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG !== -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : Infinity;
const CONCURRENCY = 10;
const BATCH_LOG_SIZE = 50;
const DOMAIN_CONTEXT_KEYWORDS = ["haulage", "logistics", "transport", "freight"] as const;
const SERPER_GEO = "uk";
const SERPER_LANGUAGE = "en-GB";

interface CompanyToResolve {
  companyName: string;
  companyRegNumber?: number;
  fleetBand: string;
  city: string | null;
  personIds: string[];
}

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

function extractCity(address: string | undefined): string | null {
  if (!address) return null;
  const stripped = address.replace(/\s+GB\s+[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\s*$/, "").trim();
  const parts = stripped.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const unitPrefix = /^(UNIT|FLOOR|SUITE|DEPOT|YARD|PLOT|OFFICE|BLOCK|ROOM)\b/i;
  const candidates = parts.filter(p => !unitPrefix.test(p));
  const city = candidates[candidates.length - 1];
  if (!city || city.length < 3) return null;
  return city.split(" ").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ");
}

async function main() {
  console.log(`=== 1210 Phase 2 Domain Resolution (new top-ups only) ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Limit: ${LIMIT === Infinity ? "none" : LIMIT}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  // ── STAGE 1: Find new top-up persons needing domains ──
  console.log("STAGE 1: Identifying companies to resolve...");

  // Target: aprSlice=true, companyDomain IS NULL, Standard licence
  const persons = await prisma.person.findMany({
    where: {
      enrichmentData: { contains: '"aprSlice":true' },
      companyDomain: null,
      OR: [
        { enrichmentData: { contains: '"licenceType":"Standard National"' } },
        { enrichmentData: { contains: '"licenceType":"Standard International"' } },
      ],
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
        city: extractCity(ed.correspondenceAddress),
        personIds: [],
      });
    }
    companyMap.get(key)!.personIds.push(p.id);
  }

  const companies = Array.from(companyMap.values());
  const toProcess = companies.slice(0, LIMIT);

  console.log(`  Total persons needing domain: ${persons.length}`);
  console.log(`  Distinct companies: ${companies.length}`);
  console.log(`  Processing: ${toProcess.length}`);

  const fleetBreakdown: Record<string, number> = {};
  for (const c of toProcess) {
    fleetBreakdown[c.fleetBand] = (fleetBreakdown[c.fleetBand] || 0) + 1;
  }
  console.log(`  Fleet bands: ${JSON.stringify(fleetBreakdown)}\n`);

  // ── STAGE 2: Run resolution ──
  console.log("STAGE 2: Running domain resolution...");

  const semaphore = new Semaphore(CONCURRENCY);
  let serperQueries = 0;
  let fallbackQueries = 0;
  let dbHits = 0;
  let resolved = 0;
  let resolvedViaFallback = 0;
  let failed = 0;
  let verificationSkips = 0;
  let processedCount = 0;
  const startTime = Date.now();

  const results: Array<{
    companyName: string;
    domain: string | null;
    source: string;
    personCount: number;
  }> = [];

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

  async function resolveOne(company: CompanyToResolve) {
    await semaphore.acquire();
    try {
      // DB cache check
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
        results.push({ companyName: company.companyName, domain: existing.domain, source: "db", personCount: company.personIds.length });
        return;
      }

      if (DRY_RUN) {
        serperQueries++;
        results.push({ companyName: company.companyName, domain: null, source: "dry-run", personCount: company.personIds.length });
        return;
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
          results.push({
            companyName: company.companyName,
            domain: candidate.domain,
            source: candidate.attempt > 1 ? "serper-fallback" : "serper",
            personCount: company.personIds.length,
          });
          return;
        }
      } catch {
        // Search error — fall through
      }

      failed++;
      results.push({ companyName: company.companyName, domain: null, source: "failed", personCount: company.personIds.length });
    } finally {
      semaphore.release();
      processedCount++;
      if (processedCount % BATCH_LOG_SIZE === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (processedCount / ((Date.now() - startTime) / 1000)).toFixed(1);
        console.log(
          `  [${elapsed}s] ${processedCount}/${toProcess.length} | ` +
          `${resolved} resolved | ${failed} failed | ${dbHits} cached | ` +
          `${serperQueries} queries ($${(serperQueries * 0.001).toFixed(2)}) | ${rate}/s`
        );
      }
    }
  }

  await Promise.allSettled(toProcess.map(c => resolveOne(c)));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const cost = (serperQueries * 0.001).toFixed(3);

  // ── STAGE 3: Report ──
  console.log(`\n=== REPORT ===\n`);
  console.log(`A. Companies processed: ${toProcess.length}`);
  console.log(`B. DB cache hits: ${dbHits}`);
  console.log(`C. Serper queries: ${serperQueries} (primary: ${serperQueries - fallbackQueries}, fallback: ${fallbackQueries}) | Cost: $${cost}`);
  console.log(`D. Resolved: ${resolved + dbHits} (serper primary: ${resolved - resolvedViaFallback}, serper fallback: ${resolvedViaFallback}, db cache: ${dbHits})`);
  console.log(`E. Failed: ${failed}`);
  console.log(`F. Resolution rate: ${(((resolved + dbHits) / toProcess.length) * 100).toFixed(1)}%`);
  console.log(`G. Elapsed: ${elapsed}s`);
  console.log(`H. Verification skips after candidate scoring: ${verificationSkips}`);

  // Sample resolved
  const resolvedResults = results.filter(r => r.domain !== null);
  console.log(`\nSample resolved (up to 10):`);
  for (const r of resolvedResults.slice(0, 10)) {
    console.log(`  ${r.companyName} → ${r.domain} [${r.source}] (${r.personCount} persons)`);
  }

  // Sample failed
  const failedResults = results.filter(r => r.domain === null);
  console.log(`\nSample failed (up to 10):`);
  for (const r of failedResults.slice(0, 10)) {
    console.log(`  ${r.companyName} (${r.personCount} persons)`);
  }

  // Person coverage
  const personsResolved = results.filter(r => r.domain).reduce((sum, r) => sum + r.personCount, 0);
  const personsUnresolved = results.filter(r => !r.domain).reduce((sum, r) => sum + r.personCount, 0);
  console.log(`\nPerson coverage:`);
  console.log(`  With domain now: ${personsResolved}`);
  console.log(`  Still without: ${personsUnresolved}`);

  // ── STAGE 4: Overall aprSlice domain coverage ──
  console.log(`\n=== OVERALL APRIL SLICE DOMAIN COVERAGE ===`);

  const totalAprSlice = await prisma.person.count({
    where: {
      enrichmentData: { contains: '"aprSlice":true' },
      workspaces: { some: { workspace: "1210-solutions" } },
    },
  });

  const aprSliceWithDomain = await prisma.person.count({
    where: {
      enrichmentData: { contains: '"aprSlice":true' },
      workspaces: { some: { workspace: "1210-solutions" } },
      companyDomain: { not: null },
    },
  });

  const aprSliceNoDomain = totalAprSlice - aprSliceWithDomain;
  const coveragePct = ((aprSliceWithDomain / totalAprSlice) * 100).toFixed(1);

  console.log(`  Total aprSlice=true: ${totalAprSlice}`);
  console.log(`  With domain: ${aprSliceWithDomain} (${coveragePct}%)`);
  console.log(`  Without domain: ${aprSliceNoDomain}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
