const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const lime = await p.client.findFirst({ where: { workspaceSlug: "lime-recruitment" }, select: { id: true, links: true } });
  const existing = lime.links ? JSON.parse(lime.links) : [];
  existing.push({ label: "Proposal (PDF)", url: "https://drive.google.com/file/d/1ckleIr3wbwN7iO0OMfWvH-iOCTLhKejj/view?usp=drive_link" });
  await p.client.update({ where: { id: lime.id }, data: { links: JSON.stringify(existing) } });
  console.log("Updated Lime links:", existing.map(l => l.label));
  await p.$disconnect();
})();
