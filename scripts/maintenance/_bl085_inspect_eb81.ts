import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    // Find all CampaignDeploy rows pointing at EB 81 or 82
    const deploys = await prisma.campaignDeploy.findMany({
      where: { emailBisonCampaignId: { in: [81, 82] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        campaignId: true,
        emailBisonCampaignId: true,
        status: true,
        emailStatus: true,
        emailError: true,
        createdAt: true,
      },
    });
    console.log("Deploys referencing EB 81/82:");
    for (const d of deploys) console.log(JSON.stringify(d, null, 2));

    const camps = await prisma.campaign.findMany({
      where: { emailBisonCampaignId: { in: [81, 82] } },
      select: { id: true, status: true, emailBisonCampaignId: true, name: true },
    });
    console.log("\nCampaigns with EB 81/82 pointer:");
    for (const c of camps) console.log(JSON.stringify(c, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
main();
