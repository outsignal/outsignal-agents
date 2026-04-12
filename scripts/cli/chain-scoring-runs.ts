/**
 * chain-scoring-runs.ts
 *
 * Runs scoring for a list of workspaces sequentially. Waits for the previous
 * run to finish before starting the next. Used to queue MyAcq, BlankTag, and
 * Rise to auto-start after the currently-running YoopKnows scoring completes.
 *
 * Usage:
 *   npx tsx scripts/cli/chain-scoring-runs.ts --wait-for yoopknows --then myacq,blanktag,rise --apply
 *
 *   # Skip the wait, start the chain immediately
 *   npx tsx scripts/cli/chain-scoring-runs.ts --then myacq,blanktag,rise --apply
 *
 * The script:
 *   1. If --wait-for is set, polls DB every 30s until that workspace has
 *      0 unscored leads OR 3 consecutive polls with no change
 *   2. For each --then workspace in order, runs the scoring script
 *      synchronously, waits for it to complete, then moves to the next
 *   3. After all runs complete, prints a final audit summary
 *
 * Safe to run in foreground or background. On completion, the JSON envelope
 * includes per-workspace results.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { PrismaClient } from "@prisma/client";
import { spawn } from "child_process";
import { checkBudget } from "@/lib/rate-limits/budget-gate";

const prisma = new PrismaClient();

interface Args {
  waitFor: string | null;
  then: string[];
  apply: boolean;
  concurrency: number;
  pollIntervalSec: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    waitFor: null,
    then: [],
    apply: false,
    concurrency: 5,
    pollIntervalSec: 30,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wait-for") args.waitFor = argv[++i];
    else if (a === "--then") args.then = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--apply") args.apply = true;
    else if (a === "--concurrency") args.concurrency = parseInt(argv[++i], 10);
    else if (a === "--poll-interval") args.pollIntervalSec = parseInt(argv[++i], 10);
  }
  return args;
}

async function getUnscoredCount(workspace: string): Promise<number> {
  return prisma.personWorkspace.count({
    where: { workspace, icpScore: null },
  });
}

async function waitForWorkspace(workspace: string, pollIntervalSec: number): Promise<void> {
  process.stderr.write(`\n[chain] Waiting for '${workspace}' to finish scoring...\n`);
  let previous = await getUnscoredCount(workspace);
  let noChangeCount = 0;
  process.stderr.write(`[chain] Initial unscored count for ${workspace}: ${previous}\n`);

  while (true) {
    await new Promise((r) => setTimeout(r, pollIntervalSec * 1000));
    const current = await getUnscoredCount(workspace);
    const delta = previous - current;
    const ts = new Date().toISOString();
    process.stderr.write(`[chain] ${ts} ${workspace}: ${current} unscored (delta ${delta >= 0 ? "-" : "+"}${Math.abs(delta)})\n`);

    if (current === 0) {
      process.stderr.write(`[chain] ${workspace} reached 0 unscored. Proceeding.\n`);
      return;
    }

    if (delta === 0) {
      noChangeCount++;
      if (noChangeCount >= 3) {
        process.stderr.write(
          `[chain] ${workspace} has ${current} unscored but count unchanged for 3 polls. Stopping wait (either finished with low-conf skips or the run died).\n`,
        );
        return;
      }
    } else {
      noChangeCount = 0;
    }
    previous = current;
  }
}

async function runScoringForWorkspace(
  workspace: string,
  apply: boolean,
  concurrency: number,
): Promise<{ workspace: string; exitCode: number | null; durationSec: number }> {
  const startedAt = Date.now();
  process.stderr.write(`\n[chain] === Starting scoring run for '${workspace}' ===\n`);

  return new Promise((resolve) => {
    const args = ["tsx", "scripts/cli/score-all-unscored.ts", "--workspace", workspace, "--concurrency", String(concurrency)];
    if (apply) args.push("--apply");

    const child = spawn("npx", args, {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env },
    });

    child.on("close", (code) => {
      const durationSec = Math.round((Date.now() - startedAt) / 1000);
      process.stderr.write(`[chain] '${workspace}' scoring exited with code ${code} after ${durationSec}s\n`);
      resolve({ workspace, exitCode: code, durationSec });
    });
  });
}

async function main(): Promise<unknown> {
  const args = parseArgs();

  if (args.then.length === 0) {
    throw new Error("No workspaces specified — use --then w1,w2,w3");
  }

  process.stderr.write(`\n[chain] Plan:\n`);
  if (args.waitFor) {
    process.stderr.write(`[chain]   1. Wait for: ${args.waitFor}\n`);
  }
  args.then.forEach((w, i) => {
    process.stderr.write(`[chain]   ${args.waitFor ? i + 2 : i + 1}. Score: ${w}\n`);
  });
  process.stderr.write(`[chain]   Apply mode: ${args.apply ? "YES" : "DRY RUN"}\n`);
  process.stderr.write(`[chain]   Concurrency: ${args.concurrency}\n`);

  if (args.waitFor) {
    await waitForWorkspace(args.waitFor, args.pollIntervalSec);
  }

  const results: Array<{ workspace: string; exitCode: number | null; durationSec: number }> = [];
  for (const w of args.then) {
    // Budget gate: check before each workspace scoring
    const budget = await checkBudget(`chain-scoring:${w}`);
    if (!budget.allow) {
      console.error(`[budget-gate] Scoring for ${w} blocked: ${budget.reason}`);
      process.exit(1);
    }
    const result = await runScoringForWorkspace(w, args.apply, args.concurrency);
    results.push(result);
    if (result.exitCode !== 0) {
      process.stderr.write(`[chain] WARNING: ${w} scoring failed (exit ${result.exitCode}). Continuing anyway.\n`);
    }
  }

  // Final summary
  process.stderr.write(`\n[chain] === Chain complete ===\n`);
  for (const r of results) {
    process.stderr.write(
      `[chain]   ${r.workspace}: exit=${r.exitCode} duration=${r.durationSec}s\n`,
    );
  }

  await prisma.$disconnect();

  return {
    waitedFor: args.waitFor,
    ranWorkspaces: args.then,
    results,
  };
}

runWithHarness("chain-scoring-runs --wait-for <slug> --then w1,w2,w3 [--apply]", main);
