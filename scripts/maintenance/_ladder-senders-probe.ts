import { prisma } from "@/lib/db";

async function main() {
  const senders = await prisma.sender.findMany({
    where: { workspaceSlug: "ladder-group" },
    select: {
      id: true,
      name: true,
      emailAddress: true,
      status: true,
      channel: true,
      sessionStatus: true,
      createdAt: true,
      warmupDay: true,
      warmupStartedAt: true,
      emailBisonSenderId: true,
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Total senders for ladder-group: ${senders.length}`);
  const byDomain: Record<string, typeof senders> = {};
  for (const s of senders) {
    const d = s.emailAddress?.split("@")[1] ?? "(no email)";
    (byDomain[d] ||= []).push(s);
  }
  for (const [d, list] of Object.entries(byDomain)) {
    console.log(`\n== ${d} (${list.length}) ==`);
    for (const s of list) {
      console.log(`  ${s.emailAddress} | status=${s.status} chan=${s.channel} sess=${s.sessionStatus} warmupDay=${s.warmupDay} ebId=${s.emailBisonSenderId ?? '-'} created=${s.createdAt.toISOString().slice(0,10)}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
