import { prisma } from '@/lib/db';

async function main() {
  const ids = ['cmmwei6pf0001zxgpbsvbbsp1', 'cmmwei6y80005zxgpptn4wd08'];
  for (const id of ids) {
    const c = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, name: true, linkedinSequence: true },
    });
    if (!c || !c.linkedinSequence) continue;
    console.log(`\n### ${c.id} — ${c.name}`);
    console.log(c.linkedinSequence);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
