const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const client = await p.client.updateMany({
    where: { workspaceSlug: "lime-recruitment" },
    data: { website: "https://limerec.co.uk" }
  });
  console.log("Updated Client:", client.count);

  const ws = await p.workspace.update({
    where: { slug: "lime-recruitment" },
    data: { website: "https://limerec.co.uk" }
  });
  console.log("Updated Workspace:", ws.slug, ws.website);

  await p.$disconnect();
})();
