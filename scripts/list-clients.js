const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const clients = await p.client.findMany({
    select: { name: true, pipelineStatus: true, workspaceSlug: true, campaignType: true, createdAt: true },
    orderBy: { pipelineStatus: "asc" }
  });
  clients.forEach(c => {
    console.log(`${c.pipelineStatus.padEnd(16)} | ${c.name.padEnd(30)} | ws: ${c.workspaceSlug || '-'.padEnd(20)} | ${c.campaignType}`);
  });
  console.log("\nTotal:", clients.length);
  await p.$disconnect();
})();
