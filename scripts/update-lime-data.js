const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  // Update Client record
  const lime = await p.client.findFirst({ where: { workspaceSlug: "lime-recruitment" } });
  await p.client.update({
    where: { id: lime.id },
    data: {
      companyOverview: "Lime Recruitment supply staff in the warehouse, logistics, manufacturing and engineering sectors. Initially targeting Bradford and Manchester based businesses. First time doing outbound — looking to generate conversations and leads within these sectors.",
      campaignType: "email_linkedin",
      notes: "Monthly rolling contract, no minimum term. 7 days notice to cancel. Fees payable monthly in advance.\n\nMonthly deliverables:\n- Up to 2 new campaigns per month\n- 1x 1hr call per fortnight (campaign updates, optimisation, new ideas)\n- Weekly campaign report (Friday PM)"
    }
  });
  console.log("Updated Client record");

  // Update Workspace record
  await p.workspace.update({
    where: { slug: "lime-recruitment" },
    data: {
      icpCountries: "United Kingdom",
      icpIndustries: "Warehouse, Logistics, Manufacturing, Engineering",
      coreOffers: "Temporary and permanent staffing solutions for warehouse, logistics, manufacturing and engineering sectors",
      billingRetainerPence: 75000,
      billingPlatformFeePence: 38000,
      monthlyCampaignAllowance: 2,
    }
  });
  console.log("Updated Workspace record");

  await p.$disconnect();
})();
