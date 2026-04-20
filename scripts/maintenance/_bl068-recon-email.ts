import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  const r = await p.campaign.findFirst({ where: { id: 'cmnpwzv9e010np8itsf3f35oy' }, select: { id: true, name: true, emailSequence: true } });
  const seq = typeof r?.emailSequence === 'string' ? JSON.parse(r.emailSequence) : r?.emailSequence;
  console.log(r?.name);
  console.log('keys:', Object.keys(seq?.[0] ?? {}));
  console.log(JSON.stringify(seq?.[0], null, 2));
  await p.$disconnect();
}
main();
