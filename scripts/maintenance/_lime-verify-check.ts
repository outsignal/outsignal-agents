import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { prisma } from "@/lib/db";

async function main() {
  const lists = await prisma.targetList.findMany({
    where: {
      workspaceSlug: "lime-recruitment",
      OR: [
        { name: { contains: "E4" } },
        { name: { contains: "E5" } },
      ],
    },
    select: { id: true, name: true, createdAt: true },
  });
  console.log("Target lists found:");
  for (const l of lists) console.log(`  ${l.id}  |  ${l.name}  |  ${l.createdAt.toISOString()}`);
  console.log();

  for (const list of lists) {
    const members = await prisma.targetListPerson.findMany({
      where: { listId: list.id },
      include: {
        person: {
          select: { id: true, email: true, enrichmentData: true },
        },
      },
    });
    const total = members.length;
    const buckets: Record<string, number> = { valid: 0, invalid: 0, risky: 0, catch_all: 0, unknown: 0, never: 0, no_email: 0 };
    const providers: Record<string, number> = {};
    const personIds: string[] = [];
    for (const m of members) {
      personIds.push(m.person.id);
      if (!m.person.email) { buckets.no_email++; continue; }
      if (!m.person.enrichmentData) { buckets.never++; continue; }
      let data: any = {};
      try { data = JSON.parse(m.person.enrichmentData); } catch { buckets.never++; continue; }
      const status = data.emailVerificationStatus as string | undefined;
      const provider = (data.emailVerificationProvider as string | undefined) || "unknown-provider";
      if (!status) { buckets.never++; continue; }
      providers[provider] = (providers[provider] || 0) + 1;
      if (status in buckets) buckets[status]++;
      else buckets.unknown++;
    }
    const ebLogs = await prisma.enrichmentLog.findMany({
      where: {
        entityType: "person",
        provider: "bounceban-verify",
        entityId: { in: personIds },
      },
      select: { entityId: true, runAt: true, status: true },
    });
    const distinctPersonsLogged = new Set(ebLogs.map((l) => l.entityId)).size;

    console.log(`=== ${list.name} (${list.id}) ===`);
    console.log(`  Total members: ${total}`);
    console.log(`  Buckets:`, buckets);
    console.log(`  Providers seen:`, providers);
    console.log(`  EnrichmentLog bounceban-verify rows: ${ebLogs.length} across ${distinctPersonsLogged} persons`);
    if (ebLogs.length > 0) {
      const minDate = ebLogs.reduce((a, l) => l.runAt < a ? l.runAt : a, ebLogs[0].runAt);
      const maxDate = ebLogs.reduce((a, l) => l.runAt > a ? l.runAt : a, ebLogs[0].runAt);
      console.log(`  BounceBan runs between: ${minDate.toISOString()} → ${maxDate.toISOString()}`);
    }
    console.log();
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
