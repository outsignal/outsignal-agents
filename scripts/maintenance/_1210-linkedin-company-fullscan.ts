/**
 * 1210 Transport — LinkedIn Company Page Full Scan
 *
 * Searches LinkedIn company pages for all 1,715 aprSlice Persons with
 * companyDomain=null. Two cohorts:
 *   - "never-had-domain": Phase 1 Serper found nothing (~127)
 *   - "stream-a-rejected": Serper found a domain but Stream A cleared it (~1,588)
 *
 * For each unique company, runs:
 *   site:linkedin.com/company "{CompanyName}" UK
 *
 * Confidence scoring:
 *   HIGH = LinkedIn slug fuzzy-matches company name (written to DB)
 *   LOW  = result found but slug doesn't match (JSON only, not written to DB)
 *
 * Budget cap: $3 (~1,715 queries x $0.001 = ~$1.72 expected)
 *
 * Writes: HIGH-confidence hits -> Person.enrichmentData.linkedinCompanyUrl
 * Output: scripts/maintenance/_1210-linkedin-company-fullscan-results.json
 *
 * Usage:
 *   npx tsx scripts/maintenance/_1210-linkedin-company-fullscan.ts [--dry-run]
 *   npx tsx scripts/maintenance/_1210-linkedin-company-fullscan.ts --resume
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
const RESUME = process.argv.includes("--resume");
const WORKSPACE = "1210-solutions";
const CONCURRENCY = 10;
const BUDGET_CAP_USD = 3.0;
const OUTPUT_PATH = path.join(
  process.cwd(),
  "scripts",
  "maintenance",
  "_1210-linkedin-company-fullscan-results.json",
);
const CHECKPOINT_PATH = path.join(
  process.cwd(),
  "scripts",
  "maintenance",
  "_1210-linkedin-company-fullscan-checkpoint.json",
);
const FLAGGED_DOMAINS_PATH = path.join(
  process.cwd(),
  "scripts",
  "maintenance",
  "_1210-apr-soft-flagged-domains.json",
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompanyGroup {
  companyName: string;
  personIds: string[];
  fleetBand: string;
  region: string;
  cohort: "never-had-domain" | "stream-a-rejected";
}

interface SearchResult {
  companyName: string;
  personIds: string[];
  fleetBand: string;
  region: string;
  cohort: "never-had-domain" | "stream-a-rejected";
  hit: boolean;
  confidence: "HIGH" | "LOW" | null;
  linkedinUrl: string | null;
  linkedinSlug: string | null;
  employeeCount: string | null;
  industryTag: string | null;
  serperSnippet: string | null;
  writtenToDb: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseED(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
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

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Normalize a string for fuzzy comparison:
 * lowercase, strip Ltd/Limited/Inc, strip punctuation, collapse whitespace
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /\b(ltd|limited|plc|inc|incorporated|llc|llp|uk|co|company|services|group|holdings)\b/g,
      "",
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract slug from a LinkedIn company URL.
 * e.g. "https://uk.linkedin.com/company/acme-transport" -> "acme-transport"
 */
function extractSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/company\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Fuzzy match: check if the LinkedIn slug is a reasonable match for the company name.
 * Returns true if the slug words overlap significantly with the normalized company name words.
 */
function isHighConfidence(companyName: string, slug: string): boolean {
  const normName = normalize(companyName);
  const nameWords = normName.split(" ").filter((w) => w.length > 1);
  const slugWords = slug
    .replace(/-/g, " ")
    .split(" ")
    .filter((w) => w.length > 1);

  if (nameWords.length === 0 || slugWords.length === 0) return false;

  // Count how many name words appear in the slug
  let matches = 0;
  for (const nw of nameWords) {
    if (slugWords.some((sw) => sw.includes(nw) || nw.includes(sw))) {
      matches++;
    }
  }

  // HIGH if >= 50% of name words match slug words
  const ratio = matches / nameWords.length;
  return ratio >= 0.5;
}

// ---------------------------------------------------------------------------
// LinkedIn company page search via Serper
// ---------------------------------------------------------------------------

async function searchLinkedInCompanyPage(companyName: string): Promise<{
  hit: boolean;
  linkedinUrl: string | null;
  linkedinSlug: string | null;
  confidence: "HIGH" | "LOW" | null;
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

  for (const r of results) {
    const url = r.link.toLowerCase();
    if (url.includes("linkedin.com/company/")) {
      let employeeCount: string | null = null;
      const empMatch = r.snippet.match(/(\d[\d,]*)\s*(?:employees?|followers?)/i);
      if (empMatch) employeeCount = empMatch[1].replace(/,/g, "");

      let industryTag: string | null = null;
      const indMatch = r.snippet.match(
        /(?:^|[|·])\s*([A-Z][A-Za-z &/]+?)\s*(?:[|·]|$|\d)/,
      );
      if (indMatch) industryTag = indMatch[1].trim();

      const slug = extractSlug(r.link);
      const confidence =
        slug && isHighConfidence(companyName, slug) ? "HIGH" : "LOW";

      return {
        hit: true,
        linkedinUrl: r.link,
        linkedinSlug: slug,
        confidence,
        employeeCount,
        industryTag,
        snippet: r.snippet,
        costUsd,
      };
    }
  }

  return {
    hit: false,
    linkedinUrl: null,
    linkedinSlug: null,
    confidence: null,
    employeeCount: null,
    industryTag: null,
    snippet: null,
    costUsd,
  };
}

// ---------------------------------------------------------------------------
// DB write: atomic per-person enrichmentData update
// ---------------------------------------------------------------------------

async function writeLinkedInUrlToPersons(
  personIds: string[],
  linkedinCompanyUrl: string,
): Promise<number> {
  let written = 0;
  for (const pid of personIds) {
    const person = await prisma.person.findUnique({
      where: { id: pid },
      select: { enrichmentData: true },
    });
    if (!person) continue;

    const ed = parseED(person.enrichmentData);
    ed.linkedinCompanyUrl = linkedinCompanyUrl;

    await prisma.person.update({
      where: { id: pid },
      data: { enrichmentData: JSON.stringify(ed) },
    });
    written++;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    "=== 1210 Transport -- LinkedIn Company Page Full Scan ===\n",
  );
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no Serper calls, no DB writes)" : "LIVE"}`);
  console.log(`Budget cap: $${BUDGET_CAP_USD}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  // -- Step 1: Load cohort classification from flagged-domains file --
  console.log("Step 1: Loading cohort classification...");
  const streamARejectedIds = new Set<string>();
  if (fs.existsSync(FLAGGED_DOMAINS_PATH)) {
    const flagged = JSON.parse(fs.readFileSync(FLAGGED_DOMAINS_PATH, "utf8"));
    for (const entry of flagged) {
      for (const pid of entry.personIds) {
        streamARejectedIds.add(pid);
      }
    }
    console.log(`  Stream A flagged-domains file: ${streamARejectedIds.size} person IDs\n`);
  } else {
    console.log("  WARNING: flagged-domains file not found, all persons classified as never-had-domain\n");
  }

  // -- Step 2: Load all aprSlice persons with null/empty companyDomain --
  console.log("Step 2: Loading unresolved aprSlice persons...");
  const rows: Array<{
    id: string;
    company: string | null;
    enrichmentData: string | null;
  }> = await prisma.$queryRaw`
    SELECT l.id, l.company, l."enrichmentData"
    FROM "Lead" l
    JOIN "LeadWorkspace" lw ON lw."leadId" = l.id
    WHERE lw.workspace = ${WORKSPACE}
      AND l."enrichmentData"::jsonb->>'aprSlice' = 'true'
      AND (l."companyDomain" IS NULL OR l."companyDomain" = '')
  `;
  console.log(`  Found ${rows.length} unresolved persons\n`);

  // -- Step 3: Dedupe to unique companies --
  console.log("Step 3: Deduplicating to unique companies...");
  const companyMap = new Map<string, CompanyGroup>();

  for (const row of rows) {
    const companyName = (row.company || "").trim();
    if (!companyName || companyName === "Unknown") continue;

    const ed = parseED(row.enrichmentData);
    const key = companyName.toLowerCase();

    if (!companyMap.has(key)) {
      const cohort = streamARejectedIds.has(row.id)
        ? "stream-a-rejected"
        : "never-had-domain";
      companyMap.set(key, {
        companyName,
        personIds: [row.id],
        fleetBand: (ed.fleetBand as string) || "unknown",
        region: (ed.region as string) || "unknown",
        cohort,
      });
    } else {
      companyMap.get(key)!.personIds.push(row.id);
      // Update cohort if any person in group was stream-a-rejected
      if (streamARejectedIds.has(row.id)) {
        companyMap.get(key)!.cohort = "stream-a-rejected";
      }
    }
  }

  const companies = Array.from(companyMap.values());
  const neverHad = companies.filter((c) => c.cohort === "never-had-domain");
  const streamARej = companies.filter((c) => c.cohort === "stream-a-rejected");

  console.log(`  Unique companies: ${companies.length}`);
  console.log(`    never-had-domain: ${neverHad.length}`);
  console.log(`    stream-a-rejected: ${streamARej.length}`);

  // Fleet band distribution
  const bandCounts: Record<string, number> = {};
  for (const c of companies) {
    bandCounts[c.fleetBand] = (bandCounts[c.fleetBand] || 0) + 1;
  }
  console.log("  Fleet band distribution:");
  for (const [band, count] of Object.entries(bandCounts).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(
      `    ${band}: ${count} (${((count / companies.length) * 100).toFixed(1)}%)`,
    );
  }

  const estimatedCost = companies.length * 0.001;
  console.log(`\n  Estimated Serper cost: $${estimatedCost.toFixed(3)}`);
  if (estimatedCost > BUDGET_CAP_USD) {
    console.log(`  WARNING: Estimated cost exceeds $${BUDGET_CAP_USD} budget cap!`);
  }
  console.log();

  // -- Step 4: Load checkpoint if resuming --
  let completedCompanies = new Map<string, SearchResult>();
  if (RESUME && fs.existsSync(CHECKPOINT_PATH)) {
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
    for (const r of checkpoint.results) {
      completedCompanies.set(r.companyName.toLowerCase(), r);
    }
    console.log(`  Resuming: ${completedCompanies.size} companies already completed\n`);
  }

  // Filter out already-completed companies
  const toSearch = companies.filter(
    (c) => !completedCompanies.has(c.companyName.toLowerCase()),
  );
  console.log(
    `Step 4: Searching ${toSearch.length} companies via Serper (${completedCompanies.size} already done)...\n`,
  );

  // -- Step 5: Serper LinkedIn search --
  let totalCost = 0;
  const results: SearchResult[] = [...completedCompanies.values()];
  let searched = 0;
  let dbWrites = 0;

  if (DRY_RUN) {
    console.log("  [DRY RUN] Skipping Serper calls and DB writes\n");
    for (const c of toSearch) {
      results.push({
        companyName: c.companyName,
        personIds: c.personIds,
        fleetBand: c.fleetBand,
        region: c.region,
        cohort: c.cohort,
        hit: false,
        confidence: null,
        linkedinUrl: null,
        linkedinSlug: null,
        employeeCount: null,
        industryTag: null,
        serperSnippet: null,
        writtenToDb: false,
        error: null,
      });
    }
  } else {
    const searchResults = await pMap(
      toSearch,
      async (c, idx) => {
        // Budget check
        if (totalCost >= BUDGET_CAP_USD) {
          console.log(`  [${idx + 1}/${toSearch.length}] BUDGET CAP -- skipping ${c.companyName}`);
          return {
            companyName: c.companyName,
            personIds: c.personIds,
            fleetBand: c.fleetBand,
            region: c.region,
            cohort: c.cohort,
            hit: false,
            confidence: null,
            linkedinUrl: null,
            linkedinSlug: null,
            employeeCount: null,
            industryTag: null,
            serperSnippet: null,
            writtenToDb: false,
            error: "BUDGET_CAP_REACHED",
          } satisfies SearchResult;
        }

        try {
          const result = await searchLinkedInCompanyPage(c.companyName);
          totalCost += result.costUsd;
          searched++;

          let writtenToDb = false;

          // Write HIGH-confidence hits to DB
          if (result.hit && result.confidence === "HIGH" && result.linkedinUrl) {
            const written = await writeLinkedInUrlToPersons(
              c.personIds,
              result.linkedinUrl,
            );
            writtenToDb = written > 0;
            dbWrites += written;
          }

          const status = result.hit
            ? `${result.confidence} HIT`
            : "MISS";
          const marker = result.hit && result.confidence === "HIGH" ? ">>>" : "   ";

          // Progress every 50 or on hits
          if (searched % 50 === 0 || result.hit) {
            console.log(
              `  ${marker}[${searched}/${toSearch.length}] ${status} -- ${c.companyName} (${c.cohort}, ${c.fleetBand})${result.linkedinSlug ? ` -> ${result.linkedinSlug}` : ""} [$${totalCost.toFixed(3)}]`,
            );
          }

          const sr: SearchResult = {
            companyName: c.companyName,
            personIds: c.personIds,
            fleetBand: c.fleetBand,
            region: c.region,
            cohort: c.cohort,
            hit: result.hit,
            confidence: result.confidence,
            linkedinUrl: result.linkedinUrl,
            linkedinSlug: result.linkedinSlug,
            employeeCount: result.employeeCount,
            industryTag: result.industryTag,
            serperSnippet: result.snippet,
            writtenToDb,
            error: null,
          };

          // Checkpoint every 100 searches
          if (searched % 100 === 0) {
            const allSoFar = [...results, sr];
            fs.writeFileSync(
              CHECKPOINT_PATH,
              JSON.stringify({ results: allSoFar, totalCost, searched }, null, 2),
            );
          }

          return sr;
        } catch (err) {
          console.log(
            `  [${idx + 1}/${toSearch.length}] ERROR -- ${c.companyName}: ${err}`,
          );
          return {
            companyName: c.companyName,
            personIds: c.personIds,
            fleetBand: c.fleetBand,
            region: c.region,
            cohort: c.cohort,
            hit: false,
            confidence: null,
            linkedinUrl: null,
            linkedinSlug: null,
            employeeCount: null,
            industryTag: null,
            serperSnippet: null,
            writtenToDb: false,
            error: String(err),
          } satisfies SearchResult;
        }
      },
      CONCURRENCY,
    );
    results.push(...searchResults);
  }

  // -- Step 6: Analysis --
  const highHits = results.filter((r) => r.confidence === "HIGH");
  const lowHits = results.filter((r) => r.confidence === "LOW");
  const misses = results.filter((r) => !r.hit && !r.error?.includes("BUDGET"));
  const errors = results.filter((r) => r.error !== null);
  const budgetSkipped = results.filter(
    (r) => r.error === "BUDGET_CAP_REACHED",
  );

  // Cohort breakdown
  const neverHadResults = results.filter(
    (r) => r.cohort === "never-had-domain",
  );
  const streamAResults = results.filter(
    (r) => r.cohort === "stream-a-rejected",
  );
  const neverHadHigh = neverHadResults.filter(
    (r) => r.confidence === "HIGH",
  );
  const streamAHigh = streamAResults.filter(
    (r) => r.confidence === "HIGH",
  );

  // Fleet band hit rates
  const hitRateByBand: Record<
    string,
    { high: number; low: number; miss: number; total: number }
  > = {};
  for (const r of results) {
    if (!hitRateByBand[r.fleetBand]) {
      hitRateByBand[r.fleetBand] = { high: 0, low: 0, miss: 0, total: 0 };
    }
    hitRateByBand[r.fleetBand].total++;
    if (r.confidence === "HIGH") hitRateByBand[r.fleetBand].high++;
    else if (r.confidence === "LOW") hitRateByBand[r.fleetBand].low++;
    else hitRateByBand[r.fleetBand].miss++;
  }

  // Count persons affected by DB writes
  const personsWithUrl = results
    .filter((r) => r.writtenToDb)
    .reduce((sum, r) => sum + r.personIds.length, 0);

  // -- Step 7: Write output --
  const output = {
    meta: {
      timestamp: new Date().toISOString(),
      workspace: WORKSPACE,
      task: "LinkedIn company-page full scan (Stream B extended)",
      budgetCapUsd: BUDGET_CAP_USD,
      actualCostUsd: Math.round(totalCost * 1000) / 1000,
      concurrency: CONCURRENCY,
      dryRun: DRY_RUN,
    },
    population: {
      totalUnresolvedPersons: rows.length,
      uniqueCompanies: companies.length,
      cohortBreakdown: {
        neverHadDomain: neverHad.length,
        streamARejected: streamARej.length,
      },
      byFleetBand: Object.fromEntries(
        Object.entries(bandCounts).sort((a, b) => b[1] - a[1]),
      ),
    },
    summary: {
      totalSearched: searched + completedCompanies.size,
      highConfidenceHits: highHits.length,
      lowConfidenceHits: lowHits.length,
      misses: misses.length,
      errors: errors.length - budgetSkipped.length,
      budgetSkipped: budgetSkipped.length,
      highHitRatePercent:
        results.length > 0
          ? Math.round((highHits.length / results.length) * 1000) / 10
          : 0,
      totalHitRatePercent:
        results.length > 0
          ? Math.round(
              ((highHits.length + lowHits.length) / results.length) * 1000,
            ) / 10
          : 0,
      byCohort: {
        neverHadDomain: {
          total: neverHadResults.length,
          highHits: neverHadHigh.length,
          highHitRatePercent:
            neverHadResults.length > 0
              ? Math.round(
                  (neverHadHigh.length / neverHadResults.length) * 1000,
                ) / 10
              : 0,
        },
        streamARejected: {
          total: streamAResults.length,
          highHits: streamAHigh.length,
          highHitRatePercent:
            streamAResults.length > 0
              ? Math.round(
                  (streamAHigh.length / streamAResults.length) * 1000,
                ) / 10
              : 0,
        },
      },
      byFleetBand: Object.fromEntries(
        Object.entries(hitRateByBand)
          .sort((a, b) => b[1].total - a[1].total)
          .map(([band, stats]) => [
            band,
            {
              ...stats,
              highHitRatePercent:
                stats.total > 0
                  ? Math.round((stats.high / stats.total) * 1000) / 10
                  : 0,
            },
          ]),
      ),
    },
    dbWrites: {
      personsUpdated: personsWithUrl,
      companiesWritten: highHits.filter((r) => r.writtenToDb).length,
    },
    projections: {
      apifyCostPerPage: 0.004,
      highHitsForScraping: highHits.length,
      estimatedApifyCost:
        Math.round(highHits.length * 0.004 * 100) / 100,
    },
    sampleHighHits: highHits.slice(0, 15).map((r) => ({
      company: r.companyName,
      cohort: r.cohort,
      fleetBand: r.fleetBand,
      linkedinUrl: r.linkedinUrl,
      slug: r.linkedinSlug,
      employeeCount: r.employeeCount,
      industryTag: r.industryTag,
      personCount: r.personIds.length,
    })),
    sampleLowHits: lowHits.slice(0, 10).map((r) => ({
      company: r.companyName,
      linkedinUrl: r.linkedinUrl,
      slug: r.linkedinSlug,
      snippet: r.serperSnippet,
    })),
    sampleMisses: misses.slice(0, 10).map((r) => ({
      company: r.companyName,
      cohort: r.cohort,
      fleetBand: r.fleetBand,
    })),
    allResults: results.map((r) => ({
      companyName: r.companyName,
      personIds: r.personIds,
      fleetBand: r.fleetBand,
      region: r.region,
      cohort: r.cohort,
      hit: r.hit,
      confidence: r.confidence,
      linkedinUrl: r.linkedinUrl,
      linkedinSlug: r.linkedinSlug,
      employeeCount: r.employeeCount,
      industryTag: r.industryTag,
      serperSnippet: r.serperSnippet,
      writtenToDb: r.writtenToDb,
      error: r.error,
    })),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nResults written to: ${OUTPUT_PATH}`);

  // Clean up checkpoint on successful completion
  if (fs.existsSync(CHECKPOINT_PATH) && budgetSkipped.length === 0) {
    fs.unlinkSync(CHECKPOINT_PATH);
    console.log("Checkpoint cleaned up (scan complete)");
  }

  // -- Console report --
  console.log("\n=== REPORT ===\n");

  console.log("1. UNIQUE COMPANY COUNT");
  console.log(`   Total unresolved persons: ${rows.length}`);
  console.log(`   Unique companies: ${companies.length}`);
  console.log(`     never-had-domain: ${neverHad.length}`);
  console.log(`     stream-a-rejected: ${streamARej.length}`);

  console.log(`\n2. SERPER SPEND`);
  console.log(`   Actual: $${totalCost.toFixed(3)}`);
  console.log(`   Budget cap: $${BUDGET_CAP_USD}`);
  console.log(`   Budget remaining: $${(BUDGET_CAP_USD - totalCost).toFixed(3)}`);

  console.log(`\n3. HIGH-CONFIDENCE HITS`);
  console.log(`   Total: ${highHits.length} / ${results.length} = ${((highHits.length / results.length) * 100).toFixed(1)}%`);
  console.log(`   By cohort:`);
  console.log(`     never-had-domain: ${neverHadHigh.length} / ${neverHadResults.length} = ${neverHadResults.length > 0 ? ((neverHadHigh.length / neverHadResults.length) * 100).toFixed(1) : 0}%`);
  console.log(`     stream-a-rejected: ${streamAHigh.length} / ${streamAResults.length} = ${streamAResults.length > 0 ? ((streamAHigh.length / streamAResults.length) * 100).toFixed(1) : 0}%`);

  console.log(`\n4. LOW-CONFIDENCE HITS (not written to DB)`);
  console.log(`   Total: ${lowHits.length}`);

  console.log(`\n5. MISSES`);
  console.log(`   Total: ${misses.length}`);

  console.log(`\n6. HIT RATE BY FLEET BAND`);
  for (const [band, stats] of Object.entries(hitRateByBand).sort(
    (a, b) => b[1].total - a[1].total,
  )) {
    const pct = stats.total > 0 ? ((stats.high / stats.total) * 100).toFixed(1) : "0.0";
    console.log(
      `   ${band}: ${stats.high} HIGH / ${stats.total} total = ${pct}% (${stats.low} LOW, ${stats.miss} miss)`,
    );
  }

  console.log(`\n7. DB WRITE CONFIRMATION`);
  console.log(`   Companies written: ${highHits.filter((r) => r.writtenToDb).length}`);
  console.log(`   Persons now with linkedinCompanyUrl: ${personsWithUrl}`);

  console.log(`\n8. PROJECTED APIFY COST (Phase B: LinkedIn page scraping)`);
  console.log(`   HIGH hits eligible for scraping: ${highHits.length}`);
  console.log(`   Cost per page: ~$0.004`);
  console.log(`   Estimated Apify cost: $${(highHits.length * 0.004).toFixed(2)}`);

  console.log(`\n9. OUTPUT FILE`);
  console.log(`   ${OUTPUT_PATH}`);

  if (errors.length - budgetSkipped.length > 0) {
    console.log(`\n10. ERRORS: ${errors.length - budgetSkipped.length} (check allResults for details)`);
  }
  if (budgetSkipped.length > 0) {
    console.log(`\n10. BUDGET SKIPPED: ${budgetSkipped.length} companies not searched (budget cap reached)`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
