/**
 * Batch email verification across all workspaces via LeadMagic.
 *
 * Processes workspaces in priority order, exhausting each workspace's
 * unverified people before moving to the next. Respects a global --limit.
 *
 * Usage:
 *   cd /Users/jjay/programs/outsignal-agents && npx tsx scripts/batch-verify-all.ts
 *   npx tsx scripts/batch-verify-all.ts --limit 3000 --workspaces lime-recruitment,1210-solutions,yoopknows
 */

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { parseArgs } from "node:util";

config();

const prisma = new PrismaClient();

const VERIFY_ENDPOINT = "https://api.leadmagic.io/v1/people/email-validation";
const TIMEOUT_MS = 10_000;
const DELAY_MS = 200;

const DEFAULT_WORKSPACES = [
  "lime-recruitment",
  "1210-solutions",
  "yoopknows",
  "rise",
  "outsignal",
];
const SKIP_WORKSPACES = new Set(["myacq"]);

interface VerifyResult {
  email: string;
  status: string;
  costUsd: number;
}

interface WorkspaceStats {
  slug: string;
  total: number;
  alreadyVerified: number;
  verifiedThisRun: number;
  errors: number;
  costUsd: number;
  counts: Record<string, number>;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyOne(
  email: string,
  personId: string
): Promise<VerifyResult> {
  const apiKey = process.env.LEADMAGIC_API_KEY;
  if (!apiKey) throw new Error("LEADMAGIC_API_KEY not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const raw: any = await res.json();
    const status = raw.email_status || "unknown";

    const COST: Record<string, number> = {
      valid: 0.05,
      invalid: 0.05,
      valid_catch_all: 0.05,
      catch_all: 0,
      unknown: 0,
    };
    const costUsd = COST[status] ?? 0;

    // Persist to enrichmentData
    const person = await prisma.person.findUnique({
      where: { id: personId },
    });
    const existing = person?.enrichmentData
      ? JSON.parse(person.enrichmentData)
      : {};
    await prisma.person.update({
      where: { id: personId },
      data: {
        enrichmentData: JSON.stringify({
          ...existing,
          emailVerificationStatus: status,
          emailVerifiedAt: new Date().toISOString(),
        }),
      },
    });

    return { email, status, costUsd };
  } finally {
    clearTimeout(timeout);
  }
}

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "3000" },
      workspaces: { type: "string" },
    },
    strict: true,
  });

  const limit = parseInt(values.limit!, 10);
  if (isNaN(limit) || limit <= 0) {
    console.error("--limit must be a positive integer");
    process.exit(1);
  }

  let workspaceSlugs = DEFAULT_WORKSPACES;
  if (values.workspaces) {
    workspaceSlugs = values.workspaces
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Filter out always-skip workspaces
  workspaceSlugs = workspaceSlugs.filter((slug) => {
    if (SKIP_WORKSPACES.has(slug)) {
      console.log(`Skipping workspace: ${slug} (always skipped)`);
      return false;
    }
    return true;
  });

  return { limit, workspaceSlugs };
}

async function getUnverifiedPeople(
  slug: string
): Promise<{ id: string; email: string }[]> {
  const personWorkspaces = await prisma.personWorkspace.findMany({
    where: { workspace: slug },
    include: {
      person: {
        select: {
          id: true,
          email: true,
          enrichmentData: true,
        },
      },
    },
  });

  const needsVerification: { id: string; email: string }[] = [];
  let alreadyVerified = 0;
  let nullEmail = 0;

  for (const pw of personWorkspaces) {
    const person = pw.person;
    if (!person.email) {
      nullEmail++;
      continue;
    }

    let hasStatus = false;
    if (person.enrichmentData) {
      try {
        const data = JSON.parse(person.enrichmentData);
        if (data.emailVerificationStatus) {
          hasStatus = true;
        }
      } catch {}
    }

    if (hasStatus) {
      alreadyVerified++;
    } else {
      needsVerification.push({ id: person.id, email: person.email });
    }
  }

  console.log(
    `  Total: ${personWorkspaces.length} | Already verified: ${alreadyVerified} | Null email: ${nullEmail} | Need verification: ${needsVerification.length}`
  );

  return needsVerification;
}

async function main() {
  const { limit, workspaceSlugs } = parseCliArgs();

  console.log("=== Batch Email Verification: All Workspaces ===\n");
  console.log(`Global limit: ${limit}`);
  console.log(`Workspace order: ${workspaceSlugs.join(" -> ")}\n`);

  let globalVerified = 0;
  let globalErrors = 0;
  let globalCost = 0;
  const allStats: WorkspaceStats[] = [];

  for (const slug of workspaceSlugs) {
    if (globalVerified >= limit) {
      console.log(`\nGlobal limit reached (${limit}). Stopping.`);
      break;
    }

    // Verify workspace exists
    const workspace = await prisma.workspace.findUnique({
      where: { slug },
    });
    if (!workspace) {
      console.log(`\nWorkspace '${slug}' not found. Skipping.`);
      continue;
    }

    console.log(`\n--- ${workspace.name} (${slug}) ---`);

    const needsVerification = await getUnverifiedPeople(slug);

    if (needsVerification.length === 0) {
      console.log("  Nothing to verify. Moving to next workspace.");
      allStats.push({
        slug,
        total: 0,
        alreadyVerified: 0,
        verifiedThisRun: 0,
        errors: 0,
        costUsd: 0,
        counts: {},
      });
      continue;
    }

    const remaining = limit - globalVerified;
    const toProcess = Math.min(needsVerification.length, remaining);
    console.log(
      `  Will process: ${toProcess} of ${needsVerification.length} (${remaining} remaining in global limit)\n`
    );

    const counts: Record<string, number> = {
      valid: 0,
      invalid: 0,
      valid_catch_all: 0,
      catch_all: 0,
      unknown: 0,
    };
    let wsVerified = 0;
    let wsErrors = 0;
    let wsCost = 0;

    for (let i = 0; i < toProcess; i++) {
      const { id, email } = needsVerification[i];
      try {
        const result = await verifyOne(email, id);
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        wsCost += result.costUsd;
        wsVerified++;
        globalVerified++;
      } catch (err: any) {
        wsErrors++;
        globalErrors++;
        console.error(`  ERROR verifying ${email}: ${err.message}`);
      }

      // Progress log every 50
      if ((i + 1) % 50 === 0 || i === toProcess - 1) {
        console.log(
          `  [${slug}] ${i + 1}/${toProcess} | ` +
            `valid=${counts.valid} invalid=${counts.invalid} catch_all=${counts.catch_all} ` +
            `valid_catch_all=${counts.valid_catch_all} unknown=${counts.unknown} errors=${wsErrors} | ` +
            `Global: ${globalVerified}/${limit}`
        );
      }

      // Rate limit delay (skip after last item)
      if (i < toProcess - 1) {
        await sleep(DELAY_MS);
      }
    }

    globalCost += wsCost;

    allStats.push({
      slug,
      total: needsVerification.length,
      alreadyVerified: 0,
      verifiedThisRun: wsVerified,
      errors: wsErrors,
      costUsd: wsCost,
      counts,
    });

    if (globalVerified >= limit) {
      console.log(`\nGlobal limit reached (${limit}). Stopping.`);
      break;
    }
  }

  // Final summary
  console.log("\n\n=== FINAL SUMMARY ===\n");

  console.log("Per-workspace breakdown:");
  console.log("-".repeat(90));
  console.log(
    `${"Workspace".padEnd(22)} ${"Verified".padStart(8)} ${"Errors".padStart(7)} ${"Valid".padStart(7)} ${"Invalid".padStart(8)} ${"CatchAll".padStart(9)} ${"VldCA".padStart(7)} ${"Unknown".padStart(8)} ${"Cost".padStart(8)}`
  );
  console.log("-".repeat(90));

  for (const s of allStats) {
    if (s.verifiedThisRun === 0 && s.errors === 0) continue;
    console.log(
      `${s.slug.padEnd(22)} ${String(s.verifiedThisRun).padStart(8)} ${String(s.errors).padStart(7)} ${String(s.counts.valid ?? 0).padStart(7)} ${String(s.counts.invalid ?? 0).padStart(8)} ${String(s.counts.catch_all ?? 0).padStart(9)} ${String(s.counts.valid_catch_all ?? 0).padStart(7)} ${String(s.counts.unknown ?? 0).padStart(8)} ${"$" + (s.costUsd).toFixed(2).padStart(7)}`
    );
  }

  console.log("-".repeat(90));
  console.log(
    `${"TOTAL".padEnd(22)} ${String(globalVerified).padStart(8)} ${String(globalErrors).padStart(7)} ${" ".repeat(49)} ${"$" + globalCost.toFixed(2).padStart(7)}`
  );
  console.log(
    `\nTotal verified:  ${globalVerified}`
  );
  console.log(`Total errors:    ${globalErrors}`);
  console.log(`Total cost:      $${globalCost.toFixed(2)}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
