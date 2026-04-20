import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.campaign.findMany({
    where: {
      deployedAt: { not: null },
      status: 'approved',
      workspace: { slug: { in: ['lime-recruitment', '1210-solutions'] } },
      updatedAt: { gte: new Date('2026-04-15T00:00:00Z') },
    },
    select: {
      id: true,
      name: true,
      workspace: { select: { slug: true } },
      deployedAt: true,
      status: true,
      contentApproved: true,
      leadsApproved: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'asc' },
  });
  console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
