const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  await p.client.updateMany({
    where: { workspaceSlug: "lime-recruitment" },
    data: {
      contactName: "Jamie Town",
      contactEmail: "jamie@limerec.co.uk",
    }
  });
  console.log("Updated Client contact");

  await p.workspace.update({
    where: { slug: "lime-recruitment" },
    data: {
      clientEmails: JSON.stringify(["jamie@limerec.co.uk"]),
      billingClientEmail: "jamie@limerec.co.uk",
    }
  });
  console.log("Updated Workspace contact emails");

  await p.$disconnect();
})();
