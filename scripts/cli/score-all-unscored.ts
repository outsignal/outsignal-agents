/**
 * score-all-unscored.ts
 *
 * One-shot backfill for INV2 (scoring coverage): score every PersonWorkspace
 * row that currently has icpScore = NULL.
 *
 * Re-uses the existing scorePersonIcp() function in src/lib/icp/scorer.ts.
 * That function already uses temperature: 0 (as of fix/bl-020-single-person-
 * scoring-temperature) and calls Haiku via the ai-sdk path.
 *
 * DOES NOT rewrite the scorer. DOES NOT change the batching strategy.
 * Just iterates every unscored lead and calls scorePersonIcp for it.
 *
 * Usage:
 *   # Dry run (default — count violations, estimate cost, do nothing)
 *   npx tsx scripts/cli/score-all-unscored.ts
 *
 *   # Apply (actually score)
 *   npx tsx scripts/cli/score-all-unscored.ts --apply
 *
 *   # Limit to one workspace
 *   npx tsx scripts/cli/score-all-unscored.ts --workspace rise --apply
 *
 *   # Limit number of leads (useful for smoke testing)
 *   npx tsx scripts/cli/score-all-unscored.ts --workspace rise --limit 20 --apply
 *
 *   # Concurrency (default 5 — Haiku is 50 req/s so this is conservative)
 *   npx tsx scripts/cli/score-all-unscored.ts --apply --concurrency 10
 *
 * Cost estimate:
 *   ~$0.001 per lead based on 2026-04-10 empirical measurement on lime-recruitment.
 *   16,606 unscored leads → ~$16-20 at current rates.
 *
 * Time estimate:
 *   Single-lead scoring via scorePersonIcp takes ~3-6s per call.
 *   With concurrency=5: ~16,606 leads / 5 = ~3,321 iterations × ~4s = ~3.7 hours.
 *   With concurrency=10: ~1.9 hours.
 *
 * Safety:
 *   - Skips leads that already have icpScore (idempotent — safe to re-run)
 *   - Skips workspaces with NULL icpCriteriaPrompt (logs and continues)
 *   - Catches per-lead errors and continues (failed leads reported at end)
 *   - --apply is required to actually score; default is dry-run
 *   - Graceful shutdown on SIGINT (prints progress so far)
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { PrismaClient } from "@prisma/client";
import { scorePersonIcp } from "@/lib/icp/scorer";

const prisma = new PrismaClient();

interface Args {
  apply: boolean;
  workspace: string | null;
  limit: number | null;
  concurrency: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    apply: false,
    workspace: null,
    limit: null,
    concurrency: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--workspace") args.workspace = argv[++i];
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--concurrency") args.concurrency = parseInt(argv[++i], 10);
  }
  return args;
}

interface Progress {
  total: number;
  scored: number;          // high/medium confidence, persisted to DB
  lowConfSkipped: number;  // low confidence, not persisted, stays null
  failed: number;          // threw an error
  failures: Array<{ personId: string; workspace: string; error: string }>;
  byWorkspace: Map<string, { scored: number; lowConfSkipped: number; failed: number }>;
  startedAt: number;
}

function bumpWorkspace(
  p: Progress,
  slug: string,
  delta: "scored" | "lowConfSkipped" | "failed",
): void {
  const entry = p.byWorkspace.get(slug) ?? { scored: 0, lowConfSkipped: 0, failed: 0 };
  entry[delta] += 1;
  p.byWorkspace.set(slug, entry);
}

function printProgress(p: Progress): void {
  const elapsed = (Date.now() - p.startedAt) / 1000;
  const done = p.scored + p.lowConfSkipped + p.failed;
  const rate = done > 0 ? (done / elapsed).toFixed(2) : "0.00";
  const remaining = p.total - done;
  const eta = done > 0 && remaining > 0 ? ((remaining / done) * elapsed).toFixed(0) : "-";
  process.stderr.write(
    `[${new Date().toISOString()}] scored=${p.scored} low_conf_skip=${p.lowConfSkipped} failed=${p.failed} remaining=${remaining} rate=${rate}/s eta=${eta}s\n`,
  );
}

async function scoreOne(
  personId: string,
  workspace: string,
): Promise<
  | { ok: true; persisted: boolean; score: number; confidence: string }
  | { ok: false; error: string }
> {
  try {
    // Opt out of low-confidence persistence — leads with confidence="low"
    // will NOT be written to DB. They stay in the unscored bucket for a
    // future retry once upstream data improves.
    const result = await scorePersonIcp(personId, workspace, false, {
      persistLowConfidence: false,
    });
    return {
      ok: true,
      persisted: result.persisted,
      score: result.score,
      confidence: result.confidence,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

async function main(): Promise<unknown> {
  const args = parseArgs();

  // Get the list of unscored PersonWorkspace rows.
  const where: { icpScore: null; workspace?: string } = { icpScore: null };
  if (args.workspace) where.workspace = args.workspace;

  const total = await prisma.personWorkspace.count({ where });

  // Per-workspace breakdown for the dry-run summary.
  const breakdown = await prisma.$queryRawUnsafe<
    Array<{ workspace: string; count: number; has_prompt: boolean }>
  >(`
    SELECT
      lw.workspace,
      COUNT(*)::int AS count,
      (w."icpCriteriaPrompt" IS NOT NULL AND LENGTH(TRIM(w."icpCriteriaPrompt")) > 0) AS has_prompt
    FROM "LeadWorkspace" lw
    LEFT JOIN "Workspace" w ON w.slug = lw.workspace
    WHERE lw."icpScore" IS NULL
    ${args.workspace ? `AND lw.workspace = '${args.workspace.replace(/'/g, "''")}'` : ""}
    GROUP BY lw.workspace, w."icpCriteriaPrompt"
    ORDER BY count DESC
  `);

  process.stderr.write(`\nUnscored PersonWorkspace rows: ${total}\n\n`);
  process.stderr.write("workspace".padEnd(28) + "count".padStart(10) + "  icp_prompt\n");
  process.stderr.write("-".repeat(50) + "\n");
  for (const row of breakdown) {
    process.stderr.write(
      row.workspace.padEnd(28) + String(row.count).padStart(10) + "  " + (row.has_prompt ? "✓" : "✗ MISSING") + "\n",
    );
  }

  const blockedRows = breakdown.filter((r) => !r.has_prompt);
  const scoreableTotal = breakdown.filter((r) => r.has_prompt).reduce((s, r) => s + r.count, 0);

  process.stderr.write("\n");
  process.stderr.write(`Scoreable (has prompt): ${scoreableTotal}\n`);
  process.stderr.write(`Blocked (no prompt): ${blockedRows.reduce((s, r) => s + r.count, 0)}\n`);

  // Apply --limit to scoreable count for cost estimate
  const willScore = args.limit && args.limit < scoreableTotal ? args.limit : scoreableTotal;
  const estimatedCost = (willScore * 0.001).toFixed(2);
  const estimatedTimeSec = Math.round((willScore * 4) / args.concurrency);
  const estimatedTimeMin = (estimatedTimeSec / 60).toFixed(1);

  process.stderr.write("\n");
  process.stderr.write(`Will score: ${willScore}\n`);
  process.stderr.write(`Estimated cost: $${estimatedCost}\n`);
  process.stderr.write(`Estimated time: ~${estimatedTimeMin} min at concurrency=${args.concurrency}\n`);

  if (!args.apply) {
    process.stderr.write("\n[DRY RUN] Nothing was scored. Pass --apply to execute.\n");
    return {
      dryRun: true,
      total,
      scoreableTotal,
      willScore,
      estimatedCostUsd: parseFloat(estimatedCost),
      estimatedTimeMinutes: parseFloat(estimatedTimeMin),
      blockedWorkspaces: blockedRows.map((r) => r.workspace),
      perWorkspace: breakdown,
    };
  }

  // --- APPLY MODE ---
  process.stderr.write(`\n[APPLY] Starting scoring run...\n\n`);

  // Get the actual personId + workspace pairs to score.
  const scoreableWorkspaces = breakdown.filter((r) => r.has_prompt).map((r) => r.workspace);
  const rows = await prisma.personWorkspace.findMany({
    where: {
      icpScore: null,
      workspace: { in: scoreableWorkspaces },
    },
    select: { personId: true, workspace: true },
    take: args.limit ?? undefined,
    // Process newest leads first — historical data quality issues cluster
    // in older ingestion batches, and processing them first produced
    // unrepresentative persist rates. Newest-first gives a truer signal
    // for whether the gate is working on current-quality data.
    orderBy: { createdAt: "desc" },
  });

  const progress: Progress = {
    total: rows.length,
    scored: 0,
    lowConfSkipped: 0,
    failed: 0,
    failures: [],
    byWorkspace: new Map(),
    startedAt: Date.now(),
  };

  // Graceful shutdown
  let shutdownRequested = false;
  process.on("SIGINT", () => {
    shutdownRequested = true;
    process.stderr.write("\n[SIGINT] Graceful shutdown requested. Finishing in-flight calls...\n");
  });

  // Fixed-size worker pool pattern.
  let cursor = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < args.concurrency; w++) {
    workers.push(
      (async () => {
        while (cursor < rows.length && !shutdownRequested) {
          const idx = cursor++;
          const row = rows[idx];
          const result = await scoreOne(row.personId, row.workspace);
          if (result.ok) {
            if (result.persisted) {
              progress.scored += 1;
              bumpWorkspace(progress, row.workspace, "scored");
            } else {
              // Low confidence: score computed but not stored. Lead stays
              // unscored until upstream data improves.
              progress.lowConfSkipped += 1;
              bumpWorkspace(progress, row.workspace, "lowConfSkipped");
            }
          } else {
            progress.failed += 1;
            bumpWorkspace(progress, row.workspace, "failed");
            progress.failures.push({
              personId: row.personId,
              workspace: row.workspace,
              error: result.error,
            });
          }
          // Periodic progress update every 25 completed calls
          if ((progress.scored + progress.lowConfSkipped + progress.failed) % 25 === 0) {
            printProgress(progress);
          }
        }
      })(),
    );
  }
  await Promise.all(workers);

  printProgress(progress);

  // Final summary
  process.stderr.write("\n=== Final report ===\n");
  process.stderr.write(`Total processed: ${progress.scored + progress.failed + progress.lowConfSkipped}\n`);
  process.stderr.write(`Scored (persisted):    ${progress.scored}\n`);
  process.stderr.write(`Low-conf skipped:      ${progress.lowConfSkipped}  (stays null, retry later)\n`);
  process.stderr.write(`Failed:                ${progress.failed}\n`);
  process.stderr.write(`\nPer-workspace:\n`);
  for (const [slug, stats] of progress.byWorkspace) {
    process.stderr.write(
      `  ${slug}: scored=${stats.scored} low_conf=${stats.lowConfSkipped} failed=${stats.failed}\n`,
    );
  }

  if (progress.failures.length > 0) {
    process.stderr.write(`\nFirst 10 failures:\n`);
    for (const f of progress.failures.slice(0, 10)) {
      process.stderr.write(`  ${f.workspace}/${f.personId}: ${f.error}\n`);
    }
  }

  const wallTimeSec = (Date.now() - progress.startedAt) / 1000;
  const actualCost = (progress.scored * 0.001).toFixed(2);
  process.stderr.write(`\nWall time: ${wallTimeSec.toFixed(0)}s\n`);
  process.stderr.write(`Estimated actual cost: ~$${actualCost}\n`);

  await prisma.$disconnect();

  return {
    apply: true,
    total: rows.length,
    scored: progress.scored,
    lowConfSkipped: progress.lowConfSkipped,
    failed: progress.failed,
    failuresCount: progress.failures.length,
    wallTimeSeconds: Math.round(wallTimeSec),
    estimatedCostUsd: parseFloat(actualCost),
    perWorkspace: Array.from(progress.byWorkspace.entries()).map(([slug, stats]) => ({
      workspace: slug,
      ...stats,
    })),
  };
}

runWithHarness("score-all-unscored [--apply] [--workspace SLUG] [--limit N] [--concurrency N]", main);
