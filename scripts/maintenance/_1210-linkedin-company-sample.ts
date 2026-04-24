/**
 * 1210 Transport — LinkedIn Company Page Hit-Rate Sample
 *
 * Stream B of Phase 2 prep. Tests whether the 205 aprSlice Persons with
 * resolvedDomain=null (genuinely small/dark operators) have LinkedIn company
 * pages. If hit rate is high enough, LinkedIn becomes a viable fallback
 * enrichment path.
 *
 * Approach:
 *   - Pull all aprSlice=true Persons where resolvedDomain is null
 *   - Stratify by fleet band, sample 50 proportionally (seeded RNG)
 *   - For each sampled company, Serper site-search:
 *       site:linkedin.com/company "{CompanyName}" UK
 *   - Record hit/miss + LinkedIn URL if found
 *
 * Cost: 50 Serper queries × $0.001 = $0.05 (well within $5 budget)
 * Writes: JSON file only — NO Person/Company record writes
 *
 * Usage: npx tsx scripts/maintenance/_1210-linkedin-company-sample.ts [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import { serperAdapter } from "@/lib/discovery/adapters/serper";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const WORKSPACE = "1210-solutions";
const SAMPLE_SIZE = 50;
const RNG_SEED = 42; // Deterministic sampling
const CONCURRENCY = 5; // Conservative — we only have 50 queries
const OUTPUT_DIR = path.join(process.cwd(), "data", "1210-linkedin-sample");

// ---------------------------------------------------------------------------
// Seeded PRNG (Mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates shuffle with seeded RNG
function seededShuffle<T>(arr: T[], rng: () => number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PersonRecord {
  id: string;
  company: string;
  fleetBand: string;
  region: string;
}

interface SampleResult {
  personId: string;
  company: string;
  fleetBand: string;
  region: string;
  hit: boolean;
  linkedinUrl: string | null;
  employeeCount: string | null;
  industryTag: string | null;
  serperSnippet: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseED(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

/** Concurrent execution with concurrency limit */
async function pMap<T, R>(
  items: T[],
  fn: (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// LinkedIn company page search via Serper
// ---------------------------------------------------------------------------

async function searchLinkedInCompanyPage(companyName: string): Promise<{
  hit: boolean;
  linkedinUrl: string | null;
  employeeCount: string | null;
  industryTag: string | null;
  snippet: string | null;
  costUsd: number;
}> {
  const { results, costUsd } = await serperAdapter.searchLinkedInCompanyPages({
    companyName,
    gl: "uk",
    hl: "en-GB",
    num: 3,
  });

  // Look for a linkedin.com/company/ URL in results
  for (const r of results) {
    const url = r.link.toLowerCase();
    if (url.includes("linkedin.com/company/")) {
      // Extract employee count from snippet if visible
      let employeeCount: string | null = null;
      const empMatch = r.snippet.match(/(\d[\d,]*)\s*(?:employees?|followers?)/i);
      if (empMatch) employeeCount = empMatch[1].replace(/,/g, "");

      // Extract industry from snippet
      let industryTag: string | null = null;
      const indMatch = r.snippet.match(
        /(?:^|[|·–—])\s*([A-Z][A-Za-z &/]+?)\s*(?:[|·–—]|$|\d)/,
      );
      if (indMatch) industryTag = indMatch[1].trim();

      return {
        hit: true,
        linkedinUrl: r.link,
        employeeCount,
        industryTag,
        snippet: r.snippet,
        costUsd,
      };
    }
  }

  return { hit: false, linkedinUrl: null, employeeCount: null, industryTag: null, snippet: null, costUsd };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("═══ 1210 Transport — LinkedIn Company Page Hit-Rate Sample ═══\n");
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no Serper calls)" : "LIVE"}`);
  console.log(`Sample size: ${SAMPLE_SIZE}`);
  console.log(`RNG seed: ${RNG_SEED}\n`);

  // ── Step 1: Load all aprSlice Persons with resolvedDomain=null ──
  console.log("Step 1: Loading aprSlice Persons with resolvedDomain=null...");

  // Get Transport target lists for region mapping
  const lists = await prisma.targetList.findMany({
    where: { workspaceSlug: WORKSPACE, name: { contains: "Transport" } },
    select: { id: true, name: true },
  });
  const listIds = lists.map(l => l.id);
  const listNameMap: Record<string, string> = {};
  for (const l of lists) listNameMap[l.id] = l.name;

  // Get person -> list mapping
  const tlpAll = await prisma.targetListPerson.findMany({
    where: { listId: { in: listIds } },
    select: { personId: true, listId: true },
  });
  const personListMap: Record<string, string> = {};
  for (const tlp of tlpAll) {
    if (!personListMap[tlp.personId]) {
      personListMap[tlp.personId] = listNameMap[tlp.listId];
    }
  }
  const allPersonIds = [...new Set(tlpAll.map(t => t.personId))];

  // Load persons with enrichmentData
  // Domain resolution stores resolved domain on Person.companyDomain (not enrichmentData)
  const batchSize = 5000;
  const unresolvedPersons: PersonRecord[] = [];

  for (let i = 0; i < allPersonIds.length; i += batchSize) {
    const batch = allPersonIds.slice(i, i + batchSize);
    const persons = await prisma.person.findMany({
      where: { id: { in: batch } },
      select: { id: true, company: true, companyDomain: true, enrichmentData: true },
    });
    for (const p of persons) {
      const ed = parseED(p.enrichmentData);
      if (ed.aprSlice !== true) continue;

      // Only unresolved domain persons (Stream B)
      // Domain resolution writes to Person.companyDomain, not enrichmentData
      if (p.companyDomain && p.companyDomain.length > 0) continue;

      const listName = personListMap[p.id] || "unknown";
      const regionMatch = listName.match(/Transport\s*[-–—]\s*(.+)/i);
      const region = regionMatch ? regionMatch[1].trim() : listName;

      unresolvedPersons.push({
        id: p.id,
        company: p.company || "Unknown",
        fleetBand: (ed.fleetBand as string) || "unknown",
        region,
      });
    }
  }

  console.log(`  Found ${unresolvedPersons.length} unresolved Persons\n`);

  // ── Step 2: Fleet-band distribution ──
  console.log("Step 2: Fleet-band distribution of unresolved Persons:");
  const bandCounts: Record<string, number> = {};
  for (const p of unresolvedPersons) {
    bandCounts[p.fleetBand] = (bandCounts[p.fleetBand] || 0) + 1;
  }
  const sortedBands = Object.entries(bandCounts).sort((a, b) => b[1] - a[1]);
  for (const [band, count] of sortedBands) {
    const pct = ((count / unresolvedPersons.length) * 100).toFixed(1);
    console.log(`  ${band}: ${count} (${pct}%)`);
  }

  // Regional distribution
  console.log("\n  Regional distribution:");
  const regionCounts: Record<string, number> = {};
  for (const p of unresolvedPersons) {
    regionCounts[p.region] = (regionCounts[p.region] || 0) + 1;
  }
  for (const [region, count] of Object.entries(regionCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / unresolvedPersons.length) * 100).toFixed(1);
    console.log(`  ${region}: ${count} (${pct}%)`);
  }

  // ── Step 3: Stratified sample ──
  console.log(`\nStep 3: Stratified sample of ${SAMPLE_SIZE}...`);
  const rng = mulberry32(RNG_SEED);

  // Group by fleet band
  const byBand: Record<string, PersonRecord[]> = {};
  for (const p of unresolvedPersons) {
    if (!byBand[p.fleetBand]) byBand[p.fleetBand] = [];
    byBand[p.fleetBand].push(p);
  }

  // Proportional allocation
  const sample: PersonRecord[] = [];
  const allocationLog: { band: string; population: number; allocated: number }[] = [];
  let remaining = SAMPLE_SIZE;

  const bandEntries = Object.entries(byBand).sort((a, b) => b[1].length - a[1].length);
  for (let i = 0; i < bandEntries.length; i++) {
    const [band, persons] = bandEntries[i];
    const isLast = i === bandEntries.length - 1;
    const allocation = isLast
      ? remaining // Last band gets whatever's left (avoids rounding errors)
      : Math.round((persons.length / unresolvedPersons.length) * SAMPLE_SIZE);
    const actual = Math.min(allocation, persons.length, remaining);

    const shuffled = seededShuffle(persons, rng);
    sample.push(...shuffled.slice(0, actual));
    allocationLog.push({ band, population: persons.length, allocated: actual });
    remaining -= actual;
  }

  console.log("  Allocation:");
  for (const { band, population, allocated } of allocationLog) {
    console.log(`    ${band}: ${allocated} sampled from ${population}`);
  }
  console.log(`  Total sample: ${sample.length}\n`);

  // Deduplicate by company name (same company may have multiple persons)
  const seenCompanies = new Set<string>();
  const dedupedSample: PersonRecord[] = [];
  for (const p of sample) {
    const key = p.company.toLowerCase().trim();
    if (!seenCompanies.has(key)) {
      seenCompanies.add(key);
      dedupedSample.push(p);
    }
  }
  if (dedupedSample.length < sample.length) {
    console.log(`  Deduped: ${sample.length} → ${dedupedSample.length} unique companies\n`);
  }

  // ── Step 4: Serper LinkedIn search ──
  console.log("Step 4: Searching LinkedIn company pages via Serper...");

  let totalCost = 0;
  const results: SampleResult[] = [];

  if (DRY_RUN) {
    console.log("  [DRY RUN] Skipping Serper calls\n");
    for (const p of dedupedSample) {
      results.push({
        personId: p.id,
        company: p.company,
        fleetBand: p.fleetBand,
        region: p.region,
        hit: false,
        linkedinUrl: null,
        employeeCount: null,
        industryTag: null,
        serperSnippet: null,
      });
    }
  } else {
    const searchResults = await pMap(
      dedupedSample,
      async (p, idx) => {
        try {
          const result = await searchLinkedInCompanyPage(p.company);
          totalCost += result.costUsd;
          const status = result.hit ? "HIT" : "MISS";
          console.log(`  [${idx + 1}/${dedupedSample.length}] ${status} — ${p.company} (${p.fleetBand})`);
          return {
            personId: p.id,
            company: p.company,
            fleetBand: p.fleetBand,
            region: p.region,
            hit: result.hit,
            linkedinUrl: result.linkedinUrl,
            employeeCount: result.employeeCount,
            industryTag: result.industryTag,
            serperSnippet: result.snippet,
          } satisfies SampleResult;
        } catch (err) {
          console.log(`  [${idx + 1}/${dedupedSample.length}] ERROR — ${p.company}: ${err}`);
          return {
            personId: p.id,
            company: p.company,
            fleetBand: p.fleetBand,
            region: p.region,
            hit: false,
            linkedinUrl: null,
            employeeCount: null,
            industryTag: null,
            serperSnippet: `ERROR: ${err}`,
          } satisfies SampleResult;
        }
      },
      CONCURRENCY,
    );
    results.push(...searchResults);
  }

  // ── Step 5: Analysis ──
  const hits = results.filter(r => r.hit);
  const misses = results.filter(r => !r.hit);
  const hitRate = results.length > 0 ? (hits.length / results.length) * 100 : 0;

  // Hit rate by fleet band
  const hitsByBand: Record<string, { hits: number; total: number }> = {};
  for (const r of results) {
    if (!hitsByBand[r.fleetBand]) hitsByBand[r.fleetBand] = { hits: 0, total: 0 };
    hitsByBand[r.fleetBand].total++;
    if (r.hit) hitsByBand[r.fleetBand].hits++;
  }

  // Hit rate by region
  const hitsByRegion: Record<string, { hits: number; total: number }> = {};
  for (const r of results) {
    if (!hitsByRegion[r.region]) hitsByRegion[r.region] = { hits: 0, total: 0 };
    hitsByRegion[r.region].total++;
    if (r.hit) hitsByRegion[r.region].hits++;
  }

  // ── Step 6: Write output ──
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const output = {
    meta: {
      timestamp: new Date().toISOString(),
      workspace: WORKSPACE,
      task: "LinkedIn company-page hit-rate sample (Stream B Phase 2)",
      rngSeed: RNG_SEED,
      sampleSize: dedupedSample.length,
      totalUnresolved: unresolvedPersons.length,
      adapterUsed: "Serper site:linkedin.com/company search",
      costPerQuery: 0.001,
      totalCostUsd: Math.round(totalCost * 1000) / 1000,
      dryRun: DRY_RUN,
    },
    population: {
      total: unresolvedPersons.length,
      byFleetBand: Object.fromEntries(sortedBands),
      byRegion: Object.fromEntries(
        Object.entries(regionCounts).sort((a, b) => b[1] - a[1]),
      ),
    },
    sampleAllocation: allocationLog,
    summary: {
      totalSearched: results.length,
      hits: hits.length,
      misses: misses.length,
      hitRatePercent: Math.round(hitRate * 10) / 10,
      hitRateByFleetBand: Object.fromEntries(
        Object.entries(hitsByBand)
          .sort((a, b) => b[1].total - a[1].total)
          .map(([band, { hits: h, total }]) => [
            band,
            { hits: h, total, hitRatePercent: Math.round((h / total) * 1000) / 10 },
          ]),
      ),
      hitRateByRegion: Object.fromEntries(
        Object.entries(hitsByRegion)
          .sort((a, b) => b[1].total - a[1].total)
          .map(([region, { hits: h, total }]) => [
            region,
            { hits: h, total, hitRatePercent: Math.round((h / total) * 1000) / 10 },
          ]),
      ),
      projectedFull205Hits: Math.round((hitRate / 100) * unresolvedPersons.length),
    },
    sampleHits: hits.slice(0, 10).map(r => ({
      company: r.company,
      fleetBand: r.fleetBand,
      region: r.region,
      linkedinUrl: r.linkedinUrl,
      employeeCount: r.employeeCount,
      industryTag: r.industryTag,
    })),
    sampleMisses: misses.slice(0, 10).map(r => ({
      company: r.company,
      fleetBand: r.fleetBand,
      region: r.region,
    })),
    allResults: results,
  };

  const outPath = path.join(OUTPUT_DIR, "linkedin-sample-results.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults written to: ${outPath}`);

  // ── Console report ──
  console.log("\n═══ REPORT ═══\n");

  console.log("1. SAMPLE COMPOSITION");
  console.log(`   Population: ${unresolvedPersons.length} unresolved Persons`);
  console.log(`   Sample: ${results.length} unique companies`);
  for (const a of allocationLog) {
    console.log(`     ${a.band}: ${a.allocated} sampled from ${a.population}`);
  }

  console.log("\n2. ADAPTER");
  console.log("   Serper site:linkedin.com/company search");
  console.log("   Query: site:linkedin.com/company \"{CompanyName}\" UK");
  console.log("   Cost: $0.001/query");
  console.log("   Why: cheapest viable route, well-tested adapter, $0.05 total vs $5 budget");

  console.log(`\n3. ACTUAL SPEND: $${(totalCost).toFixed(3)}`);

  console.log(`\n4. HIT RATE`);
  console.log(`   Overall: ${hits.length}/${results.length} = ${hitRate.toFixed(1)}%`);
  console.log("   By fleet band:");
  for (const [band, { hits: h, total }] of Object.entries(hitsByBand).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`     ${band}: ${h}/${total} = ${((h / total) * 100).toFixed(1)}%`);
  }
  console.log("   By region:");
  for (const [region, { hits: h, total }] of Object.entries(hitsByRegion).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`     ${region}: ${h}/${total} = ${((h / total) * 100).toFixed(1)}%`);
  }
  console.log(`\n   Projected full-${unresolvedPersons.length} hits: ~${Math.round((hitRate / 100) * unresolvedPersons.length)}`);

  console.log("\n5. SAMPLE HITS (up to 5):");
  for (const r of hits.slice(0, 5)) {
    console.log(`   ✓ ${r.company} (${r.fleetBand}, ${r.region})`);
    if (r.linkedinUrl) console.log(`     URL: ${r.linkedinUrl}`);
    if (r.employeeCount) console.log(`     Employees: ${r.employeeCount}`);
  }

  console.log("\n   SAMPLE MISSES (up to 5):");
  for (const r of misses.slice(0, 5)) {
    console.log(`   ✗ ${r.company} (${r.fleetBand}, ${r.region})`);
  }

  console.log("\n6. RECOMMENDATION:");
  if (hitRate >= 60) {
    console.log("   STRONG YES — LinkedIn is a viable fallback enrichment path.");
    console.log(`   ${hitRate.toFixed(0)}% hit rate means ~${Math.round((hitRate / 100) * unresolvedPersons.length)} of ${unresolvedPersons.length} unresolved`);
    console.log("   companies have LinkedIn pages. Recommend proceeding with full");
    console.log("   LinkedIn people-search for the unresolved bucket.");
  } else if (hitRate >= 35) {
    console.log("   CONDITIONAL — LinkedIn covers a meaningful subset.");
    console.log(`   ${hitRate.toFixed(0)}% hit rate means ~${Math.round((hitRate / 100) * unresolvedPersons.length)} of ${unresolvedPersons.length} would have pages.`);
    console.log("   Worth pursuing for the companies that DO have pages, but won't");
    console.log("   fully replace domain-based enrichment for the rest.");
  } else {
    console.log("   WEAK — LinkedIn coverage is too low to be a reliable fallback.");
    console.log(`   ${hitRate.toFixed(0)}% hit rate means only ~${Math.round((hitRate / 100) * unresolvedPersons.length)} of ${unresolvedPersons.length} would have pages.`);
    console.log("   These are genuinely dark operators. Consider alternative approaches:");
    console.log("   manual domain guessing, Companies House data, or excluding this bucket.");
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
