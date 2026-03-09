const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const lime = await p.client.findFirst({ where: { workspaceSlug: "lime-recruitment" }, select: { id: true, links: true } });
  const existing = lime.links ? JSON.parse(lime.links) : [];
  existing.push({ label: "Profile Pictures", url: "https://drive.google.com/drive/folders/1YBm683gZSfnrv3oGpH0W05UEVg1VYxG0?usp=sharing" });
  await p.client.update({ where: { id: lime.id }, data: { links: JSON.stringify(existing) } });
  console.log("Updated Lime links:", existing);
  await p.$disconnect();
})();
