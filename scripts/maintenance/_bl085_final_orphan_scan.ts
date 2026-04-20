/**
 * BL-085 final orphan scan — after EB 82 deletion confirmed, list all
 * remaining EB campaigns and cross-reference against our Campaign table
 * to confirm zero orphans in 1210-solutions.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "1210-solutions";

async function main() {
  const prisma = new PrismaClient();
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    const ebClient = new EmailBisonClient(workspace.apiToken!);

    const allEb = await ebClient.getCampaigns();
    console.log(`[final-scan] EB has ${allEb.length} campaign(s) in ${WORKSPACE_SLUG}:`);
    for (const c of allEb) {
      console.log(`  EB ${c.id} | status=${c.status} | name='${c.name}'`);
    }

    const ourCampaigns = await prisma.campaign.findMany({
      where: { workspaceSlug: WORKSPACE_SLUG, emailBisonCampaignId: { not: null } },
      select: { id: true, emailBisonCampaignId: true, name: true, status: true },
    });
    const ourDeploys = await prisma.campaignDeploy.findMany({
      where: { workspaceSlug: WORKSPACE_SLUG, emailBisonCampaignId: { not: null } },
      select: { id: true, campaignId: true, emailBisonCampaignId: true, status: true },
    });

    const knownEbIds = new Set<number>();
    for (const c of ourCampaigns)
      if (c.emailBisonCampaignId != null) knownEbIds.add(c.emailBisonCampaignId);
    for (const d of ourDeploys)
      if (d.emailBisonCampaignId != null) knownEbIds.add(d.emailBisonCampaignId);

    console.log(`[final-scan] Our DB knows about EB IDs: ${[...knownEbIds].sort((a, b) => a - b).join(", ")}`);

    const orphans = allEb.filter((c) => !knownEbIds.has(c.id));
    console.log(`[final-scan] Orphans (in EB but not in our DB): ${orphans.length}`);
    for (const o of orphans) {
      console.log(`  ORPHAN EB ${o.id} | status=${o.status} | name='${o.name}'`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
