import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const stuck = ['cmneqa5r50003p8rk322w3vc6','cmneq1z3i0001p8ef36c814py','cmneqixvz0003p871m8sw9u7o','cmneq93i80001p8p78pcw4yg9'];
  const rows = await prisma.campaign.findMany({
    where: { id: { in: stuck } },
    select: { id: true, name: true, linkedinSequence: true },
  });
  for (const r of rows) {
    const seq = typeof r.linkedinSequence === 'string' ? JSON.parse(r.linkedinSequence) : r.linkedinSequence;
    console.log(`\n=== ${r.id} — ${r.name}`);
    console.log(JSON.stringify(seq, null, 2));
  }

  // Sanity: any existing rule rows for these campaigns?
  const names = rows.map(r => r.name);
  const rules = await prisma.campaignSequenceRule.findMany({
    where: { campaignName: { in: names } },
    select: { id: true, campaignName: true, position: true, variantKey: true, actionType: true, triggerEvent: true },
    orderBy: [{ campaignName: 'asc' }, { position: 'asc' }],
  });
  console.log(`\n=== Rule rows found: ${rules.length}`);
  console.log(JSON.stringify(rules, null, 2));

  // Global variantKey sampling
  const variantKeyStats = await prisma.campaignSequenceRule.groupBy({
    by: ['variantKey'],
    _count: { _all: true },
  });
  console.log('\n=== Global variantKey distribution:');
  console.log(JSON.stringify(variantKeyStats, null, 2));

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
