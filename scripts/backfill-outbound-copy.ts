/**
 * One-off backfill: populate outboundSubject/outboundBody on existing Reply records.
 *
 * Groups replies by Outsignal campaignId to minimize EB API calls (1 call per campaign).
 * Idempotent: only updates replies where outboundSubject IS NULL.
 *
 * Usage:
 *   npx tsx scripts/backfill-outbound-copy.ts           # execute backfill
 *   npx tsx scripts/backfill-outbound-copy.ts --dry-run  # report counts only
 */

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "@prisma/client";
import { lookupOutboundCopy } from "../src/lib/outbound-copy-lookup";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== BACKFILL ===");

  // 1. Find all replies with a campaign link but no outbound copy
  const replies = await prisma.reply.findMany({
    where: {
      campaignId: { not: null },
      outboundSubject: null,
    },
    select: {
      id: true,
      campaignId: true,
      sequenceStep: true,
      workspaceSlug: true,
    },
  });

  console.log(`Found ${replies.length} replies needing outbound copy\n`);

  if (replies.length === 0) {
    console.log("Nothing to backfill.");
    await prisma.$disconnect();
    return;
  }

  // 2. Group by campaignId
  const byCampaign = new Map<string, typeof replies>();
  for (const r of replies) {
    const key = r.campaignId!;
    if (!byCampaign.has(key)) byCampaign.set(key, []);
    byCampaign.get(key)!.push(r);
  }

  console.log(`Grouped into ${byCampaign.size} campaigns\n`);

  // 3. Process each campaign group
  const stats: Record<string, { populated: number; skipped: number }> = {};
  let totalPopulated = 0;
  let totalSkipped = 0;

  for (const [campaignId, campaignReplies] of byCampaign) {
    // Look up campaign name for logging
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { workspaceSlug: true, name: true },
    });

    if (!campaign) {
      console.log(`  Campaign ${campaignId}: not found in DB, skipping ${campaignReplies.length} replies`);
      totalSkipped += campaignReplies.length;
      continue;
    }

    const ws = campaign.workspaceSlug;
    if (!stats[ws]) stats[ws] = { populated: 0, skipped: 0 };

    // Match each reply using the shared lookup utility
    let campaignPopulated = 0;
    let campaignSkipped = 0;

    for (const reply of campaignReplies) {
      const { subject, body } = await lookupOutboundCopy(
        campaignId,
        reply.sequenceStep,
      );

      if (subject || body) {
        if (!dryRun) {
          await prisma.reply.update({
            where: { id: reply.id },
            data: { outboundSubject: subject, outboundBody: body },
          });
        }
        campaignPopulated++;
      } else {
        campaignSkipped++;
      }
    }

    stats[ws].populated += campaignPopulated;
    stats[ws].skipped += campaignSkipped;
    totalPopulated += campaignPopulated;
    totalSkipped += campaignSkipped;

    console.log(
      `  "${campaign.name}" (${ws}): ${campaignPopulated}/${campaignReplies.length} populated, ${campaignSkipped} skipped`,
    );

    // Rate limit between campaigns
    await delay(200);
  }

  // 5. Per-workspace summary
  console.log("\n=== Per-Workspace Summary ===");
  for (const [ws, s] of Object.entries(stats)) {
    console.log(`  ${ws}: ${s.populated} populated, ${s.skipped} skipped`);
  }

  console.log(`\n=== Total: ${totalPopulated}/${replies.length} populated, ${totalSkipped} skipped ===`);
  if (dryRun) console.log("(dry run -- no updates written)");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Backfill failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
