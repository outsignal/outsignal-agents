import { prisma } from "@/lib/db";
async function main() {
  const ids = [
    "cmnpwzv9e010np8itsf3f35oy","cmnpwzwi5011sp8itj20w1foq","cmnpwzxmg012gp8itxv4dvmyb",
    "cmnpwzym5014op8it2cpupfwx","cmnpx037s01dcp8itzzilfdfb","cmnq5nivc0001p8534g0k4wr6",
    "cmneq92p20000p8p7dhqn8g42","cmneqixpv0001p8710bov1fga","cmneq1sdj0001p8cg97lb9rhd",
    "cmneqhwo50001p843r5hmsul3","cmneqa5180001p8rkwyrrlkg8",
  ];
  const rows = await prisma.campaign.findMany({
    where: { id: { in: ids }, emailSequence: { not: null } },
    select: { id: true, name: true, emailSequence: true }
  });
  const out = rows.map(r => {
    const seq = JSON.parse(r.emailSequence || "[]");
    const keys = seq[0] ? Object.keys(seq[0]).sort() : [];
    const hasPosition = seq.length > 0 && seq.every((s: Record<string, unknown>) => "position" in s);
    const hasStepNumber = seq.length > 0 && seq.every((s: Record<string, unknown>) => "stepNumber" in s);
    return {
      id: r.id,
      name: r.name.slice(0, 60),
      steps: seq.length,
      hasPosition,
      hasStepNumber,
      keys: keys.join(","),
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
