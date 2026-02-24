export interface PackageTemplate {
  label: string;
  proposalIntro: string;
  setupTitle: string;
  setupDetails: string[];
  ongoingTitle: string;
  ongoingDetails: string[];
  deliverables: string[];
  platformFees: string | null;
}

export const PACKAGE_LABELS: Record<string, string> = {
  email: "Email Outbound",
  linkedin: "LinkedIn Outbound",
  email_linkedin: "Email + LinkedIn Outbound",
};

export const DEFAULT_PRICING: Record<
  string,
  { setupFee: number; platformCost: number; retainerCost: number }
> = {
  email: { setupFee: 0, platformCost: 45000, retainerCost: 105000 },
  linkedin: { setupFee: 150000, platformCost: 35000, retainerCost: 85000 },
  email_linkedin: {
    setupFee: 150000,
    platformCost: 80000,
    retainerCost: 190000,
  },
};

const EMAIL_TEMPLATE: PackageTemplate = {
  label: "Email Outbound",
  proposalIntro:
    "Implement B2B outbound lead generation campaigns via email to build a pipeline of qualified conversations. Campaigns will be rolled out strategically, building deep market knowledge before expanding. Initially set up the infrastructure (2 weeks) before activating, monitoring and optimising campaigns.",
  setupTitle: "Infrastructure Set Up (2 weeks — up to 17 days)",
  setupDetails: [
    "Domains: Lookalike domains",
    "Email Accounts: Purchased via inbox reseller",
    "Warmup: Domains and Email Accounts",
    "Email Sequencer: Instantly, Smartlead or dedicated IP server",
    "Sending settings",
  ],
  ongoingTitle: "On-going Campaign Management",
  ongoingDetails: [
    "Leads: Scrape, enrich and verify leads from data sources",
    "Add qualified leads to active campaigns",
    "Copy Assets: Social proof, offer or lead magnet, call to action",
    "Write copy based on above: 2–3 step email sequence",
    "Campaign Monitoring: Reply rates, bounce rates, blacklisted domains and email accounts",
    "Weekly reporting on campaign progress",
  ],
  deliverables: [
    "Up to 2 new campaigns launched per month (targeting new regions or sectors)",
    "1 x 1-hour call per fortnight covering campaign updates, optimisation and new ideas",
    "Weekly campaign report delivered Friday PM",
  ],
  platformFees: null,
};

const LINKEDIN_TEMPLATE: PackageTemplate = {
  label: "LinkedIn Outbound",
  proposalIntro:
    "Implement B2B outbound lead generation via LinkedIn to expand the customer pipeline. Initially set up the campaign before activating, monitoring and optimising. For full transparency, automating LinkedIn connections and messaging is against the LinkedIn TOS so there is a risk that your account can be limited. We ensure we don't hit the max limits (800 connections/month) and instead focus on quality, with solid targeting and messaging.",
  setupTitle: "Campaign Setup (Month 1)",
  setupDetails: [
    "LinkedIn Sequencer Setup: Heyreach or LinkedHelper (1 x account connected)",
    "Sending settings",
    "Leads: Scrape, enrich (with Clay, OpenAI, Claude), add leads to campaign",
    "Copy assets: Social proof, Offer/Lead Magnet, Call to action",
    "Write copy based on above: 2–3 step LinkedIn sequence",
    "Campaign Monitoring: Reply rates, connections accepted, follow up messages sent",
    "Reporting: Weekly reporting on campaign progress",
  ],
  ongoingTitle: "On-going Retainer (Month 2+)",
  ongoingDetails: [
    "LinkedIn Sequencer: Maintenance",
    "Leads: Scrape, enrich (with Clay, OpenAI, Claude), add leads to campaign",
    "Optimise copy: Based on previous months campaign performance",
    "Campaign Monitoring: Reply rates, connections accepted, follow up messages sent",
    "Reporting: Weekly reporting on campaign progress",
  ],
  deliverables: [
    "Lead Connection Requests: max 800 (based on sequencer limits)",
    "1 x 1-hour call per fortnight covering campaign updates, optimisation and new ideas",
    "Weekly campaign report delivered Friday PM",
  ],
  platformFees:
    "The platform fees cover the costs of the following platforms: LinkedIn Sequencer (Heyreach/LinkedIn Helper), Leads (A-Leads, Clay, Sales Navigator, Apollo, Apify, Serper), Enrichment (OpenAI API, Claude API).",
};

export function getTemplate(packageType: string): PackageTemplate[] {
  switch (packageType) {
    case "email":
      return [EMAIL_TEMPLATE];
    case "linkedin":
      return [LINKEDIN_TEMPLATE];
    case "email_linkedin":
      return [EMAIL_TEMPLATE, LINKEDIN_TEMPLATE];
    default:
      return [EMAIL_TEMPLATE];
  }
}

export const PAYMENT_TERMS = `This will be a month-by-month rolling contract with no minimum term or contract lock-in. Please give 7 days' notice prior to cancelling (to allow time to stop platform billing). Fees are payable monthly in advance at the start of each calendar month (or date of contract start), covering services to be provided during that month.`;

export const DISCLAIMER = `We do everything we can to maximise deliverability and ensure campaigns succeed. However, we cannot guarantee specific outcomes such as leads, meetings or sales. Results depend on many factors outside our control, including product-market fit, the strength of your offer, your brand reputation and your internal sales process and follow-up. Our role is to give you the best possible foundation for results by delivering targeted outreach, clear messaging and strong campaign placement.`;

export function formatPence(pence: number): string {
  return (pence / 100).toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
