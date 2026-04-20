import { prisma } from "@/lib/db";

async function main() {
  const senders = await prisma.sender.findMany({
    where: {
      channel: { in: ["linkedin", "both"] },
      workspace: { slug: { in: ["lime-recruitment", "1210-solutions", "blanktag"] } }
    },
    include: { workspace: { select: { slug: true } } },
    orderBy: [{ workspace: { slug: "asc" } }, { name: "asc" }]
  });

  for (const s of senders) {
    const a = s as any;
    console.log(`[${s.workspace.slug}] ${s.name} status=${s.status} liSession=${a.linkedinSessionStatus} channel=${s.channel} dailyLimit=${a.dailyConnectionLimit} pendingConns=${a.pendingConnectionCount}`);
  }
  console.log(`\nTotal LI senders across lime+1210+blanktag: ${senders.length}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
