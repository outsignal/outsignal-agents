const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const rise = await p.client.create({
    data: {
      name: "Rise",
      pipelineStatus: "closed_won",
      campaignType: "email_linkedin",
      workspaceSlug: "rise",
      website: "https://riseheadwear.com",
    }
  });
  console.log("Created Rise client:", rise.id);

  const outsignal = await p.client.create({
    data: {
      name: "Outsignal",
      pipelineStatus: "closed_won",
      campaignType: "email_linkedin",
      workspaceSlug: "outsignal",
      website: "https://outsignal.ai",
    }
  });
  console.log("Created Outsignal client:", outsignal.id);

  await p.$disconnect();
})();
