/**
 * Batch ICP scoring script — scores all unscored leads in a target list.
 *
 * Usage:
 *   npx tsx scripts/batch-icp-score.ts --listId <targetListId> --workspace <slug> [--concurrency 5] [--dry-run]
 *
 * Requires .env with DATABASE_URL and ANTHROPIC_API_KEY.
 */
import { PrismaClient } from "@prisma/client";
import { scorePersonIcp, scorePersonIcpBatch } from "../src/lib/icp/scorer";
import { prefetchDomains } from "../src/lib/icp/crawl-cache";

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    flags[args[i].replace(/^--/, "")] = args[i + 1];
  }
  return {
    listId: flags.listId,
    workspace: flags.workspace,
    concurrency: parseInt(flags.concurrency ?? "3", 10),
    dryRun: process.argv.includes("--dry-run"),
    batch: !process.argv.includes("--no-batch"),
    batchSize: parseInt(flags["batch-size"] ?? "15", 10),
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { listId, workspace, concurrency, dryRun, batch, batchSize } = parseArgs();

  if (!listId || !workspace) {
    console.error(
      "Usage: npx tsx scripts/batch-icp-score.ts --listId <id> --workspace <slug> [--concurrency N] [--no-batch] [--batch-size N]",
    );
    process.exit(1);
  }

  console.log(`Mode: ${batch ? `batch (size=${batchSize})` : `individual (concurrency=${concurrency})`}`);

  // Get all person IDs in the target list
  const listPeople = await prisma.targetListPerson.findMany({
    where: { listId },
    select: { personId: true },
  });
  const personIds = listPeople.map((lp) => lp.personId);
  console.log(`Total people in list: ${personIds.length}`);

  // Find unscored ones
  const unscored = await prisma.personWorkspace.findMany({
    where: {
      personId: { in: personIds },
      workspace,
      icpScore: null,
    },
    select: { personId: true },
  });

  console.log(`Unscored: ${unscored.length}`);

  if (dryRun) {
    console.log("Dry run — exiting.");
    await prisma.$disconnect();
    return;
  }

  if (unscored.length === 0) {
    console.log("Nothing to score.");
    await prisma.$disconnect();
    return;
  }

  // Prefetch company website crawls to avoid duplicate Firecrawl calls during scoring
  const unscoredPeople = await prisma.person.findMany({
    where: { id: { in: unscored.map((u) => u.personId) } },
    select: { id: true, companyDomain: true },
  });

  const domains = unscoredPeople.map((p) => p.companyDomain);
  console.log(`Prefetching website crawls for ${new Set(domains.filter(Boolean)).size} unique domains...`);
  const prefetchResult = await prefetchDomains(domains);
  console.log(
    `Prefetch complete: ${prefetchResult.cached} cached, ${prefetchResult.crawled} crawled, ${prefetchResult.failed} failed`
  );

  const unscoredIds = unscored.map((u) => u.personId);
  const startTime = Date.now();

  if (batch) {
    // --- Batch mode: use scorePersonIcpBatch (handles internal chunking) ---
    console.log(`Scoring ${unscoredIds.length} people in batch mode (internal batch size=${batchSize})...`);

    const result = await scorePersonIcpBatch(unscoredIds, workspace, {
      batchSize,
      forceRecrawl: false,
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `\nDone in ${totalTime}s. Scored: ${result.scored}, Failed: ${result.failed}, Skipped: ${result.skipped}`,
    );
  } else {
    // --- Individual mode: score one person per Claude call ---
    let scored = 0;
    let failed = 0;

    for (let i = 0; i < unscoredIds.length; i += concurrency) {
      const chunk = unscoredIds.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        chunk.map((personId) => scorePersonIcp(personId, workspace)),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          scored++;
        } else {
          failed++;
          console.error(`  FAIL: ${result.reason?.message?.slice(0, 120)}`);
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const total = scored + failed;
      const pct = ((total / unscoredIds.length) * 100).toFixed(1);
      const rate = (total / (parseFloat(elapsed) || 1)).toFixed(1);
      const eta = ((unscoredIds.length - total) / (parseFloat(rate) || 1)).toFixed(0);
      console.log(
        `[${elapsed}s] ${total}/${unscoredIds.length} (${pct}%) — ${scored} scored, ${failed} failed — ${rate}/s — ETA ${eta}s`,
      );

      // Small delay between batches to avoid rate limits
      if (i + concurrency < unscoredIds.length) {
        await sleep(200);
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nDone in ${totalTime}s. Scored: ${scored}, Failed: ${failed}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
