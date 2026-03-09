const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const clients = await p.client.findMany({ select: { id: true, name: true, workspaceSlug: true, contactEmail: true, contactName: true, website: true, companyOverview: true, pipelineStatus: true } });
  console.log(JSON.stringify(clients, null, 2));
  await p.$disconnect();
})();
