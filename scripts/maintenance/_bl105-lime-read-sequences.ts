import { prisma } from '@/lib/db';

async function main() {
  const ids = ['cmmwei6pf0001zxgpbsvbbsp1', 'cmmwei6y80005zxgpptn4wd08'];
  for (const id of ids) {
    const c = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, name: true, status: true, workspaceSlug: true, channels: true, linkedinSequence: true, updatedAt: true }
    });
    if (!c) {
      console.log(`NOT FOUND: ${id}`);
      continue;
    }
    console.log('\n=================================================');
    console.log(`ID: ${c.id}`);
    console.log(`Name: ${c.name}`);
    console.log(`Status: ${c.status}`);
    console.log(`Workspace: ${c.workspaceSlug}`);
    console.log(`Channels: ${c.channels}`);
    console.log(`UpdatedAt: ${c.updatedAt.toISOString()}`);
    console.log('--- linkedinSequence (raw JSON) ---');
    if (c.linkedinSequence) {
      const parsed = JSON.parse(c.linkedinSequence);
      for (const step of parsed) {
        console.log(`\n[Step ${step.position} | type=${step.type} | delayDays=${step.delayDays}]`);
        console.log(step.body);
      }
    } else {
      console.log('(null)');
    }
  }
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
