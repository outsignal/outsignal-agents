const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const ws = await p.workspace.findUnique({ where: { slug: "lime-recruitment" } });
  console.log(JSON.stringify(ws, null, 2));
  await p.$disconnect();
})();
