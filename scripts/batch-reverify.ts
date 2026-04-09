/**
 * Batch re-verification of target list leads via BounceBan (+ Kitt fallback).
 *
 * Reads leads from a target list (by --campaignName or --listId within a --workspace),
 * re-verifies each email via BounceBan, falls back to Kitt for "unknown" results,
 * overwrites stale verification data on the Person record, and removes invalid
 * leads from the target list.
 *
 * Usage:
 *   cd /Users/jjay/programs/outsignal-agents
 *   npx tsx scripts/batch-reverify.ts --workspace lime-recruitment --campaignName "Lime Recruitment - Email - E4 - Factory Manager"
 *   npx tsx scripts/batch-reverify.ts --workspace lime-recruitment --listId clxyz123
 *   npx tsx scripts/batch-reverify.ts --workspace lime-recruitment --campaignName "E4" --dry-run
 *
 * Flags:
 *   --workspace      Required. Workspace slug.
 *   --campaignName   Campaign name (or substring) to find the linked target list.
 *   --listId         Direct target list ID (alternative to --campaignName).
 *   --dry-run        Preview what would happen without making API calls or DB changes.
 *   --concurrency    Number of concurrent verifications (default: 1).
 */

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { parseArgs } from "node:util";
import {
  verifyEmail as bouncebanVerify,
  type VerificationResult,
} from "../src/lib/verification/bounceban";
import { verifyEmail as kittVerify } from "../src/lib/verification/kitt";

config();

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string" },
      campaignName: { type: "string" },
      listId: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      concurrency: { type: "string", default: "1" },
    },
    strict: true,
  });

  if (!values.workspace) {
    console.error("ERROR: --workspace is required");
    process.exit(1);
  }

  if (!values.campaignName && !values.listId) {
    console.error("ERROR: Either --campaignName or --listId is required");
    process.exit(1);
  }

  const concurrency = parseInt(values.concurrency!, 10);
  if (isNaN(concurrency) || concurrency < 1) {
    console.error("ERROR: --concurrency must be a positive integer");
    process.exit(1);
  }

  return {
    workspace: values.workspace!,
    campaignName: values.campaignName,
    listId: values.listId,
    dryRun: values["dry-run"] ?? false,
    concurrency,
  };
}

// ---------------------------------------------------------------------------
// Target list resolution
// ---------------------------------------------------------------------------

async function resolveTargetListId(args: {
  workspace: string;
  campaignName?: string;
  listId?: string;
}): Promise<{ listId: string; listName: string }> {
  // Direct list ID
  if (args.listId) {
    const list = await prisma.targetList.findUnique({
      where: { id: args.listId },
    });
    if (!list) {
      console.error(`ERROR: Target list '${args.listId}' not found`);
      process.exit(1);
    }
    if (list.workspaceSlug !== args.workspace) {
      console.error(
        `ERROR: Target list '${args.listId}' belongs to workspace '${list.workspaceSlug}', not '${args.workspace}'`
      );
      process.exit(1);
    }
    return { listId: list.id, listName: list.name };
  }

  // Resolve via campaign name (substring match)
  const campaigns = await prisma.campaign.findMany({
    where: {
      workspaceSlug: args.workspace,
      name: { contains: args.campaignName!, mode: "insensitive" },
    },
    select: { id: true, name: true, targetListId: true },
  });

  if (campaigns.length === 0) {
    console.error(
      `ERROR: No campaigns found matching '${args.campaignName}' in workspace '${args.workspace}'`
    );
    process.exit(1);
  }

  if (campaigns.length > 1) {
    console.error(
      `ERROR: Multiple campaigns match '${args.campaignName}':`
    );
    for (const c of campaigns) {
      console.error(`  - ${c.name} (${c.id})`);
    }
    console.error("Use a more specific --campaignName or use --listId directly");
    process.exit(1);
  }

  const campaign = campaigns[0];
  if (!campaign.targetListId) {
    console.error(
      `ERROR: Campaign '${campaign.name}' has no linked target list`
    );
    process.exit(1);
  }

  const list = await prisma.targetList.findUnique({
    where: { id: campaign.targetListId },
  });
  if (!list) {
    console.error(
      `ERROR: Target list '${campaign.targetListId}' referenced by campaign not found`
    );
    process.exit(1);
  }

  console.log(`Resolved campaign: ${campaign.name}`);
  return { listId: list.id, listName: list.name };
}

// ---------------------------------------------------------------------------
// Load leads from target list
// ---------------------------------------------------------------------------

interface LeadToVerify {
  personId: string;
  email: string;
  targetListPersonId: string;
  currentStatus: string | null;
}

async function loadLeads(listId: string): Promise<LeadToVerify[]> {
  const members = await prisma.targetListPerson.findMany({
    where: { listId },
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

  const leads: LeadToVerify[] = [];
  let nullEmail = 0;

  for (const m of members) {
    if (!m.person.email) {
      nullEmail++;
      continue;
    }

    let currentStatus: string | null = null;
    if (m.person.enrichmentData) {
      try {
        const data = JSON.parse(m.person.enrichmentData);
        currentStatus = data.emailVerificationStatus ?? null;
      } catch {
        // malformed JSON, treat as unverified
      }
    }

    leads.push({
      personId: m.person.id,
      email: m.person.email,
      targetListPersonId: m.id,
      currentStatus,
    });
  }

  if (nullEmail > 0) {
    console.log(`  Skipping ${nullEmail} leads with no email address`);
  }

  return leads;
}

// ---------------------------------------------------------------------------
// Verification with Kitt fallback
// ---------------------------------------------------------------------------

async function verifyWithFallback(
  email: string,
  personId: string
): Promise<VerificationResult> {
  // Primary: BounceBan
  const bbResult = await bouncebanVerify(email, personId);

  // Fallback: if BounceBan returns "unknown", try Kitt
  if (bbResult.status === "unknown") {
    console.log(`    [fallback] BounceBan returned unknown for ${email}, trying Kitt...`);
    try {
      const kittResult = await kittVerify(email, personId);
      return kittResult;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`    [fallback] Kitt failed for ${email}: ${message}`);
      // Return the BounceBan unknown result if Kitt also fails
      return bbResult;
    }
  }

  return bbResult;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseCliArgs();

  console.log("=== Batch Re-Verification ===\n");
  console.log(`Workspace:   ${args.workspace}`);
  if (args.dryRun) console.log("Mode:        DRY RUN (no API calls, no DB changes)\n");

  // Verify workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { slug: args.workspace },
  });
  if (!workspace) {
    console.error(`ERROR: Workspace '${args.workspace}' not found`);
    process.exit(1);
  }

  // Resolve target list
  const { listId, listName } = await resolveTargetListId(args);
  console.log(`Target list: ${listName} (${listId})`);

  // Load leads
  const leads = await loadLeads(listId);
  console.log(`Leads to verify: ${leads.length}\n`);

  if (leads.length === 0) {
    console.log("Nothing to verify. Exiting.");
    await prisma.$disconnect();
    return;
  }

  // Estimate cost
  const estimatedCost = leads.length * 0.005;
  console.log(`Estimated cost: $${estimatedCost.toFixed(2)} (BounceBan @ $0.005/each)`);
  console.log(`  (Kitt fallback for unknowns adds ~$0.0015/each)\n`);

  if (args.dryRun) {
    console.log("DRY RUN -- showing current verification status breakdown:\n");
    const statusCounts: Record<string, number> = {};
    for (const lead of leads) {
      const s = lead.currentStatus ?? "unverified";
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }
    for (const [status, count] of Object.entries(statusCounts).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${status.padEnd(20)} ${count}`);
    }
    console.log(`\nWould verify ${leads.length} emails. Exiting dry run.`);
    await prisma.$disconnect();
    return;
  }

  // Process verifications
  const counts: Record<string, number> = {
    valid: 0,
    invalid: 0,
    risky: 0,
    catch_all: 0,
    valid_catch_all: 0,
    unknown: 0,
  };
  let totalCost = 0;
  let errors = 0;
  const invalidPersonIds: { personId: string; targetListPersonId: string }[] =
    [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];

    try {
      const result = await verifyWithFallback(lead.email, lead.personId);
      counts[result.status] = (counts[result.status] ?? 0) + 1;
      totalCost += result.costUsd;

      if (result.status === "invalid") {
        invalidPersonIds.push({
          personId: lead.personId,
          targetListPersonId: lead.targetListPersonId,
        });
      }
    } catch (err: unknown) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR verifying ${lead.email}: ${message}`);
    }

    // Progress log every 25 or on last item
    if ((i + 1) % 25 === 0 || i === leads.length - 1) {
      console.log(
        `  [${i + 1}/${leads.length}] ` +
          `valid=${counts.valid} invalid=${counts.invalid} risky=${counts.risky} ` +
          `catch_all=${counts.catch_all} valid_catch_all=${counts.valid_catch_all} ` +
          `unknown=${counts.unknown} errors=${errors}`
      );
    }
  }

  // Remove invalid leads from the target list
  let removed = 0;
  if (invalidPersonIds.length > 0) {
    console.log(
      `\nRemoving ${invalidPersonIds.length} invalid leads from target list...`
    );
    for (const entry of invalidPersonIds) {
      try {
        await prisma.targetListPerson.delete({
          where: { id: entry.targetListPersonId },
        });
        removed++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `  Failed to remove target list entry ${entry.targetListPersonId}: ${message}`
        );
      }
    }
    console.log(`  Removed ${removed} invalid leads from target list.`);
  }

  // Final summary
  console.log("\n=== SUMMARY ===\n");
  console.log(`Target list: ${listName}`);
  console.log(`Total leads: ${leads.length}`);
  console.log(`Errors:      ${errors}`);
  console.log(`Cost:        $${totalCost.toFixed(2)}\n`);

  console.log("Verification breakdown:");
  console.log("-".repeat(35));
  for (const [status, count] of Object.entries(counts).sort(
    (a, b) => b[1] - a[1]
  )) {
    if (count > 0) {
      const pct = ((count / leads.length) * 100).toFixed(1);
      console.log(`  ${status.padEnd(18)} ${String(count).padStart(5)}  (${pct}%)`);
    }
  }
  console.log("-".repeat(35));

  if (removed > 0) {
    console.log(`\nInvalid leads removed from list: ${removed}`);
    console.log(`Remaining leads in list: ${leads.length - removed}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
