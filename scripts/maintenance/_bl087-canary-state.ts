import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const c = await prisma.campaign.findUniqueOrThrow({
    where: { id: "cmneqixpv0001p8710bov1fga" },
    select: { id: true, status: true, emailBisonCampaignId: true, deployedAt: true, contentApproved: true },
  });
  console.log("Canary campaign:", c);

  const deploys = await prisma.campaignDeploy.findMany({
    where: { campaignId: "cmneqixpv0001p8710bov1fga" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, status: true, emailStatus: true, emailError: true, emailBisonCampaignId: true, createdAt: true, completedAt: true },
  });
  console.log("\nLast 3 deploys:");
  for (const d of deploys) {
    console.log(JSON.stringify(d, null, 2));
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
