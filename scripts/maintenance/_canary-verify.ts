import { prisma } from "@/lib/db";
async function main() {
  const rows = await prisma.campaign.findMany({
    where: { id: { in: ["cmneqixpv0001p8710bov1fga", "cmneqixvz0003p871m8sw9u7o"] } },
    select: {
      id: true, name: true, status: true,
      emailBisonCampaignId: true, signalEmailBisonCampaignId: true,
      deployedAt: true,
      deploys: { select: { id: true, status: true, createdAt: true, error: true }, orderBy: { createdAt: "desc" }, take: 3 }
    }
  });
  console.log(JSON.stringify(rows, null, 2));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
