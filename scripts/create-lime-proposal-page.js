const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const lime = await p.client.findFirst({ where: { workspaceSlug: "lime-recruitment" }, select: { id: true } });
  
  const page = await p.page.create({
    data: {
      title: "Lime Recruitment Proposal",
      slug: "lime-recruitment-proposal",
      clientId: lime.id,
      content: `# Lime Recruitment Proposal

## Overview

Lime Recruitment are focussed on supplying staff in the warehouse, logistics, manufacturing and engineering sectors. Initially they want to target Bradford and Manchester based businesses. They are looking for outbound to generate conversations and leads within these sectors and have not done any form of outbound so far.

## Proposal

Implement B2B outbound lead generation campaigns via email and LinkedIn to help Lime Recruitment expand their customer base. Initially setup the infrastructure (2 weeks) before activating, monitoring and optimising campaigns.

## Infrastructure Set Up (2 weeks - up to 17 days)

Infrastructure is anything we need to implement to provide the foundations for successful outbound campaigns.

- **Domains:** Lookalike domains of Lime Recruitment
- **Email Accounts:** Purchased via inbox reseller
- **Warmup:** Domains and Email Accounts
- **Email Sequencer:** Instantly, Smartlead or use my dedicated IP server
- **LinkedIn Sequencer:** Heyreach
- **Sending settings**

## On-going Campaign Management

- **Leads:** Scrape, enrich, verify leads, add leads to campaign
- **Copy assets:** Social proof, Offer/Lead Magnet, Call to action
- **Write copy based on above:**
  - 2-3 step email sequence
  - 2-3 step LinkedIn sequence
- **Campaign Monitoring:** Reply rates, bounce rates, blacklisted domains + email accounts
- **Reporting:** Weekly reporting on campaign progress

## Monthly Deliverables

- Up to 2 new campaigns launched per month
- 1 x 1 hour call per fortnight
  - Campaign updates
  - Optimisation
  - New ideas
- Weekly campaign report (delivered Friday PM)

## Payment & Terms

- Month by month rolling contract, no minimum term or contract lock in.
- 7 days notice prior to cancelling (to allow time to stop platform billing).
- Fees are payable monthly in advance at the start of each calendar month (or date of contract start).

| Item | Cost |
|------|------|
| Contract Length | Ongoing - Monthly |
| Platform costs | £380/month |
| Retainer | £750/month |`
    }
  });
  
  console.log("Created page:", page.id, page.slug);
  await p.$disconnect();
})();
