import { prisma } from "@/lib/db";

async function main() {
  const campaigns = await prisma.campaign.findMany({
    where: { workspaceSlug: "lime-recruitment" },
    select: {
      id: true, name: true, status: true, channels: true,
      emailBisonCampaignId: true, deployedAt: true, createdAt: true,
      contentApproved: true, leadsApproved: true,
      targetList: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { deployedAt: "desc" }],
  });
  console.log(`Total campaigns: ${campaigns.length}\n`);
  for (const c of campaigns) {
    console.log(`[${c.status}] ${c.name}`);
    console.log(`  channels=${JSON.stringify(c.channels)} ebId=${c.emailBisonCampaignId} deployedAt=${c.deployedAt?.toISOString() ?? "null"}`);
    console.log(`  contentApproved=${c.contentApproved} leadsApproved=${c.leadsApproved} list=${c.targetList?.name ?? "none"}`);
    console.log();
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
