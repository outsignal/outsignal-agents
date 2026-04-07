/**
 * Migration script: Cancel premature LinkedIn message actions and create CampaignSequenceRules
 *
 * Before Phase 70, deployLinkedInChannel pre-scheduled ALL steps including post-connect
 * messages. Existing campaigns may have pending message actions for prospects whose
 * connections are still pending or have not been sent yet. These premature messages need
 * to be cancelled, and corresponding CampaignSequenceRules need to be created so the
 * connection-poller can trigger them correctly when acceptance is detected.
 *
 * Usage:
 *   npx tsx scripts/migrate-linkedin-state-machine.ts --dry-run   # preview changes (default)
 *   npx tsx scripts/migrate-linkedin-state-machine.ts              # apply changes
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[DRY RUN] No changes will be made.\n");

  // 1. Find all pending message actions (regular priority only, not P1 fast-track)
  const pendingMessages = await prisma.linkedInAction.findMany({
    where: {
      actionType: "message",
      status: "pending",
      priority: 5, // Regular priority only — do NOT touch P1 fast-track actions
    },
    select: {
      id: true,
      personId: true,
      workspaceSlug: true,
      senderId: true,
      campaignName: true,
      messageBody: true,
      sequenceStepRef: true,
    },
  });

  console.log(`Found ${pendingMessages.length} pending P5 message action(s).`);

  // 2. Check each action — is the person connected?
  const actionsToCancel: typeof pendingMessages = [];
  let skippedNoPersonId = 0;
  let alreadyConnected = 0;

  for (const action of pendingMessages) {
    if (!action.personId) {
      skippedNoPersonId++;
      continue;
    }

    const connection = await prisma.linkedInConnection.findFirst({
      where: {
        personId: action.personId,
        senderId: action.senderId,
        status: "connected",
      },
    });

    if (!connection) {
      // Person is NOT connected — this message was pre-scheduled prematurely
      actionsToCancel.push(action);
    } else {
      // Person IS connected — leave the message action alone
      alreadyConnected++;
    }
  }

  console.log(`  Premature (not connected): ${actionsToCancel.length}`);
  console.log(`  Already connected (left alone): ${alreadyConnected}`);
  console.log(`  Skipped (no personId): ${skippedNoPersonId}`);

  // 3. Cancel the premature actions in batch
  if (actionsToCancel.length > 0) {
    const ids = actionsToCancel.map((a) => a.id);
    if (!dryRun) {
      const result = await prisma.linkedInAction.updateMany({
        where: { id: { in: ids } },
        data: { status: "cancelled" },
      });
      console.log(`\nCancelled ${result.count} premature message action(s).`);
    } else {
      console.log(`\nWould cancel ${ids.length} premature message action(s).`);
    }
  } else {
    console.log("\nNo premature message actions to cancel.");
  }

  // 4. Group cancelled actions by workspace + campaign
  const campaignGroups = new Map<string, typeof actionsToCancel>();
  for (const action of actionsToCancel) {
    if (!action.campaignName) continue;
    const key = `${action.workspaceSlug}::${action.campaignName}`;
    if (!campaignGroups.has(key)) campaignGroups.set(key, []);
    campaignGroups.get(key)!.push(action);
  }

  // 5. Create CampaignSequenceRules for campaigns that need them
  let campaignsWithNewRules = 0;
  let totalRulesCreated = 0;

  for (const [key, actions] of campaignGroups) {
    const [workspaceSlug, campaignName] = key.split("::");

    const existingRules = await prisma.campaignSequenceRule.count({
      where: {
        workspaceSlug,
        campaignName,
        triggerEvent: "connection_accepted",
      },
    });

    if (existingRules > 0) {
      console.log(
        `  Rules already exist for "${campaignName}" in ${workspaceSlug} (${existingRules} rules) — skipping`
      );
      continue;
    }

    // Deduplicate by sequenceStepRef to get unique message steps
    const uniqueSteps = new Map<string, (typeof actions)[0]>();
    for (const action of actions) {
      const ref = action.sequenceStepRef ?? `message_${uniqueSteps.size + 1}`;
      if (!uniqueSteps.has(ref)) uniqueSteps.set(ref, action);
    }

    let position = 1;
    for (const [, action] of uniqueSteps) {
      if (!dryRun) {
        await prisma.campaignSequenceRule.create({
          data: {
            workspaceSlug,
            campaignName,
            triggerEvent: "connection_accepted",
            actionType: "message",
            messageTemplate: action.messageBody,
            delayMinutes: position === 1 ? 24 * 60 : position * 48 * 60, // 1 day for first, 2 days * position for subsequent
            position,
          },
        });
      }
      position++;
    }

    const rulesCount = position - 1;
    totalRulesCreated += rulesCount;
    campaignsWithNewRules++;
    console.log(
      `  ${dryRun ? "Would create" : "Created"} ${rulesCount} connection_accepted rule(s) for "${campaignName}" in ${workspaceSlug}`
    );
  }

  // 6. Summary
  console.log("\n=== Migration Summary ===");
  console.log(`Total pending P5 messages checked: ${pendingMessages.length}`);
  console.log(
    `Premature messages ${dryRun ? "to cancel" : "cancelled"}: ${actionsToCancel.length}`
  );
  console.log(
    `Campaigns with ${dryRun ? "new" : "created"} rules: ${campaignsWithNewRules} (${totalRulesCreated} rules total)`
  );
  console.log(`Already-connected messages left alone: ${alreadyConnected}`);
  console.log(`Skipped (no personId): ${skippedNoPersonId}`);

  if (dryRun && (actionsToCancel.length > 0 || campaignsWithNewRules > 0)) {
    console.log(
      "\nRun without --dry-run to apply changes."
    );
  }

  if (!dryRun && actionsToCancel.length === 0 && campaignsWithNewRules === 0) {
    console.log("\nNo changes needed. Migration is already complete.");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
