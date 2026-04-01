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
import { EmailBisonClient } from "../src/lib/emailbison/client";
import type { SequenceStep } from "../src/lib/emailbison/types";

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

  // 3. Cache workspace API tokens
  const tokenCache = new Map<string, string>();

  // 4. Process each campaign group
  const stats: Record<string, { populated: number; skipped: number }> = {};
  let totalPopulated = 0;
  let totalSkipped = 0;

  for (const [campaignId, campaignReplies] of byCampaign) {
    // Look up campaign details
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        emailSequence: true,
        emailBisonCampaignId: true,
        workspaceSlug: true,
        name: true,
      },
    });

    if (!campaign) {
      console.log(`  Campaign ${campaignId}: not found in DB, skipping ${campaignReplies.length} replies`);
      totalSkipped += campaignReplies.length;
      continue;
    }

    const ws = campaign.workspaceSlug;
    if (!stats[ws]) stats[ws] = { populated: 0, skipped: 0 };

    // Try local emailSequence first
    let localSteps: { position: number; subjectLine?: string; body?: string }[] | null = null;
    if (campaign.emailSequence) {
      try {
        localSteps = JSON.parse(campaign.emailSequence);
      } catch {
        // ignore
      }
    }

    // Fetch from EB API if no local steps
    let ebSteps: SequenceStep[] | null = null;
    if (!localSteps && campaign.emailBisonCampaignId) {
      // Get API token (cached)
      if (!tokenCache.has(ws)) {
        const workspace = await prisma.workspace.findUnique({
          where: { slug: ws },
          select: { apiToken: true },
        });
        if (workspace?.apiToken) tokenCache.set(ws, workspace.apiToken);
      }

      const token = tokenCache.get(ws);
      if (token) {
        try {
          const client = new EmailBisonClient(token);
          ebSteps = await client.getSequenceSteps(campaign.emailBisonCampaignId);
        } catch (err) {
          console.warn(`  EB API error for campaign "${campaign.name}" (EB ID ${campaign.emailBisonCampaignId}):`, err);
        }
      } else {
        console.log(`  No API token for workspace "${ws}", skipping campaign "${campaign.name}"`);
      }
    }

    // Match each reply
    let campaignPopulated = 0;
    let campaignSkipped = 0;

    for (const reply of campaignReplies) {
      let subject: string | null = null;
      let body: string | null = null;

      // Try local match
      if (localSteps && reply.sequenceStep != null) {
        const match = localSteps.find((s) => s.position === reply.sequenceStep);
        if (match) {
          subject = match.subjectLine ?? null;
          body = match.body ?? null;
        }
      }

      // Try EB API match
      if (!subject && ebSteps) {
        if (reply.sequenceStep != null) {
          // Exact match
          let match = ebSteps.find((s) => s.position === reply.sequenceStep);
          // Off-by-one fallback
          if (!match) {
            match = ebSteps.find((s) => s.position === reply.sequenceStep! - 1);
          }
          if (match) {
            subject = match.subject || null;
            body = match.body || null;
          }
        } else if (ebSteps.length === 1) {
          // Single-step campaign fallback
          subject = ebSteps[0].subject || null;
          body = ebSteps[0].body || null;
        }
      }

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
