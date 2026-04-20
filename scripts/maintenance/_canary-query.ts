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
      id: true, name: true, status: true, channels: true, contentApproved: true, leadsApproved: true,
      workspace: { select: { slug: true } },
      targetList: { select: { id: true, name: true, _count: { select: { people: true } } } },
    }
  });
  const out = rows.map(r => ({
    id: r.id, ws: r.workspace.slug, name: r.name,
    status: r.status, channels: r.channels,
    contentOk: r.contentApproved, leadsOk: r.leadsApproved,
    targetList: r.targetList?.name ?? "(none)",
    leads: r.targetList?._count.people ?? 0,
  })).sort((a, b) => a.leads - b.leads);
  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
