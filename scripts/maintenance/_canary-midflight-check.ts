import { prisma } from "@/lib/db";
async function main() {
  const c = await prisma.campaign.findUnique({
    where: { id: "cmneqixpv0001p8710bov1fga" },
    select: {
      id: true, status: true, emailBisonCampaignId: true, deployedAt: true,
      deploys: { select: { id: true, status: true, createdAt: true, completedAt: true, emailStatus: true, emailError: true, emailBisonCampaignId: true }, orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  console.log(JSON.stringify(c, null, 2));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
