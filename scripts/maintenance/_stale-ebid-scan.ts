import { prisma } from "@/lib/db";
async function main() {
  const ids = [
    "cmnpwzv9e010np8itsf3f35oy","cmnpwzwi5011sp8itj20w1foq","cmnpwzxmg012gp8itxv4dvmyb",
    "cmnpwzym5014op8it2cpupfwx","cmnpx037s01dcp8itzzilfdfb","cmnq5nivc0001p8534g0k4wr6",
    "cmnehed0a0003p8amvswj7flf",
    "cmneq92p20000p8p7dhqn8g42","cmneqixpv0001p8710bov1fga","cmneq1sdj0001p8cg97lb9rhd",
    "cmneqhwo50001p843r5hmsul3","cmneqa5180001p8rkwyrrlkg8","cmneq93i80001p8p78pcw4yg9",
    "cmneqixvz0003p871m8sw9u7o","cmneq1z3i0001p8ef36c814py","cmneqhyd30001p8493tg1codq",
    "cmneqa5r50003p8rk322w3vc6",
  ];
  const rows = await prisma.campaign.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, status: true,
      emailBisonCampaignId: true,
      channels: true,
      deploys: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  const table = rows.map(r => ({
    ws: r.name.split(" - ")[0],
    name: r.name,
    status: r.status,
    ebId: r.emailBisonCampaignId,
    lastDeploy: r.deploys[0]?.status ?? "(none)",
    channel: JSON.parse(r.channels)[0],
  })).sort((a, b) => {
    const aStale = a.ebId != null && a.status === "approved";
    const bStale = b.ebId != null && b.status === "approved";
    return (bStale ? 1 : 0) - (aStale ? 1 : 0);
  });
  console.log(JSON.stringify(table, null, 2));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
