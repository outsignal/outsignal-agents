/**
 * Migration script: Fix misordered pre_warm_view actions
 *
 * Finds all pending pre_warm_view actions and ensures they are scheduled
 * BEFORE their associated connect/connection_request actions.
 *
 * Usage:
 *   npx tsx scripts/migrate-prewarm-actions.ts          # dry-run (default)
 *   npx tsx scripts/migrate-prewarm-actions.ts --apply   # apply changes
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

interface Correction {
  preWarmId: string;
  connectId: string;
  oldTime: Date;
  newTime: Date;
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  console.log(
    dryRun
      ? "[DRY RUN] No changes will be made."
      : "[APPLY] Changes will be written to DB."
  );
  console.log("");

  // 1. Find all pending pre_warm_view actions
  // Use select to avoid fetching parentActionId which may not exist in DB yet
  const preWarmActions = await prisma.linkedInAction.findMany({
    where: {
      status: "pending",
      sequenceStepRef: "pre_warm_view",
    },
    select: {
      id: true,
      personId: true,
      senderId: true,
      campaignName: true,
      scheduledFor: true,
    },
  });

  const total = preWarmActions.length;
  console.log(`Found ${total} pending pre_warm_view action(s).`);

  if (total === 0) {
    console.log("Nothing to migrate.");
    return;
  }

  let withConnect = 0;
  let correct = 0;
  let orphaned = 0;
  const corrections: Correction[] = [];

  // 2. For each pre_warm_view, find associated connect action
  for (const preWarm of preWarmActions) {
    const connectAction = await prisma.linkedInAction.findFirst({
      where: {
        personId: preWarm.personId,
        senderId: preWarm.senderId,
        campaignName: preWarm.campaignName,
        status: "pending",
        actionType: { in: ["connect", "connection_request"] },
      },
      select: {
        id: true,
        scheduledFor: true,
      },
    });

    if (!connectAction) {
      orphaned++;
      console.log(
        `  [ORPHAN] pre_warm_view ${preWarm.id} has no associated pending connect action.`
      );
      continue;
    }

    withConnect++;

    // 3. Check ordering: view should be BEFORE connect
    const viewTime = preWarm.scheduledFor.getTime();
    const connectTime = connectAction.scheduledFor.getTime();

    if (viewTime >= connectTime) {
      // Misordered: view is at or after connect
      const gap = connectTime - Date.now();
      const newScheduledFor =
        gap > FOUR_HOURS_MS
          ? new Date(connectTime - FOUR_HOURS_MS)
          : new Date(connectTime - FIVE_MIN_MS);

      if (!dryRun) {
        await prisma.linkedInAction.update({
          where: { id: preWarm.id },
          data: { scheduledFor: newScheduledFor },
        });
      }

      corrections.push({
        preWarmId: preWarm.id,
        connectId: connectAction.id,
        oldTime: preWarm.scheduledFor,
        newTime: newScheduledFor,
      });

      console.log(
        `  [MISORDERED] pre_warm_view ${preWarm.id}: was ${preWarm.scheduledFor.toISOString()}, connect at ${connectAction.scheduledFor.toISOString()} -> ${dryRun ? "would reschedule" : "rescheduled"} to ${newScheduledFor.toISOString()}`
      );
    } else {
      correct++;
    }
  }

  // 4. Summary
  console.log("\n=== Migration Summary ===");
  console.log(`Total pre_warm_view pending: ${total}`);
  console.log(`With associated connect: ${withConnect}`);
  console.log(`Correctly ordered: ${correct}`);
  console.log(`Misordered (${dryRun ? "would fix" : "fixed"}): ${corrections.length}`);
  console.log(`Orphaned (no connect): ${orphaned}`);

  if (dryRun && corrections.length > 0) {
    console.log("\nRun with --apply to fix misordered actions.");
  }

  if (!dryRun && corrections.length > 0) {
    console.log(`\nSuccessfully corrected ${corrections.length} action(s).`);
  }

  if (corrections.length === 0 && orphaned === 0) {
    console.log("\nAll actions are correctly ordered. No changes needed.");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
