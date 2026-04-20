import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const idx: any = await p.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'Campaign' AND indexname LIKE '%emailBisonCampaignId%';
  `);
  console.log('INDEXES:', JSON.stringify(idx, null, 2));
  await p.$disconnect();
})();
