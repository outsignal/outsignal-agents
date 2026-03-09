const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  await p.client.updateMany({
    where: { workspaceSlug: "lime-recruitment" },
    data: { contactPhone: "+44 7584 685368" }
  });
  console.log("Updated Lime phone");
  await p.$disconnect();
})();
