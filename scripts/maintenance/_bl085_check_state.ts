import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const canary = await prisma.campaign.findUnique({
      where: { id: "cmneqixpv0001p8710bov1fga" },
      select: { id: true, status: true, emailBisonCampaignId: true, deployedAt: true, workspaceSlug: true, name: true },
    });
    console.log("CANARY:", JSON.stringify(canary, null, 2));

    const lastDeploy = await prisma.campaignDeploy.findFirst({
      where: { campaignId: "cmneqixpv0001p8710bov1fga" },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, emailStatus: true, emailError: true, emailBisonCampaignId: true, createdAt: true },
    });
    console.log("LAST DEPLOY:", JSON.stringify(lastDeploy, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
main();
