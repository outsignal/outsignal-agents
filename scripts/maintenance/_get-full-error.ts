import { prisma } from "@/lib/db";
async function main() {
  const deploy = await prisma.campaignDeploy.findUnique({
    where: { id: "cmo1ig1yf0001zx4qpfhv8do3" },
    select: { id: true, error: true, emailError: true, emailStatus: true, emailBisonCampaignId: true }
  });
  console.log(JSON.stringify(deploy, null, 2));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
