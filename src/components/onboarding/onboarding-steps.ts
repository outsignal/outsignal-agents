export interface Step {
  id: string;
  question: string;
  description?: string;
  type: "text" | "textarea" | "email" | "checkbox" | "custom";
  required?: boolean;
  placeholder?: string;
}

export const ONBOARDING_STEPS: Step[] = [
  {
    id: "name",
    question: "What is your company or client name?",
    type: "text",
    required: true,
    placeholder: "e.g. BlankTag Media",
  },
  {
    id: "vertical",
    question: "What industry or vertical are you in?",
    type: "text",
    placeholder: "e.g. SaaS, Recruitment, E-commerce",
  },
  {
    id: "website",
    question: "What is your website URL?",
    type: "text",
    placeholder: "e.g. blanktag.co.uk",
  },
  {
    id: "notificationEmails",
    question: "Which email addresses should receive reply notifications?",
    description: "Comma-separated. These will be notified when a lead replies.",
    type: "text",
    placeholder: "you@company.com, colleague@company.com",
  },
  {
    id: "linkedinUsername",
    question: "What is the LinkedIn username or email for the sender account?",
    description: "This is the LinkedIn account we'll use for outreach (if applicable).",
    type: "text",
    placeholder: "username@email.com",
  },
  {
    id: "linkedinPasswordNote",
    question: "Will you send the LinkedIn password privately?",
    description: "Check this box to confirm you'll share the password via a secure channel.",
    type: "checkbox",
  },
  {
    id: "senderFullName",
    question: "What is the sender's full name?",
    description: "The person who will appear as the email/message sender.",
    type: "text",
    required: true,
    placeholder: "e.g. James Jay",
  },
  {
    id: "senderJobTitle",
    question: "What is the sender's job title?",
    type: "text",
    placeholder: "e.g. Managing Director",
  },
  {
    id: "senderPhone",
    question: "What is the sender's phone number?",
    type: "text",
    placeholder: "e.g. +44 7XXX XXXXXX",
  },
  {
    id: "senderAddress",
    question: "What is the sender's business address?",
    description: "Used in email signatures for compliance.",
    type: "textarea",
    placeholder: "123 Business St\nLondon, UK",
  },
  {
    id: "icpCountries",
    question: "Which countries or regions should we target?",
    description: "List the geographic areas where your ideal customers are based.",
    type: "textarea",
    placeholder: "e.g. United Kingdom, United States, Germany",
  },
  {
    id: "icpIndustries",
    question: "Which industries should we target?",
    type: "textarea",
    placeholder: "e.g. Technology, Healthcare, Financial Services",
  },
  {
    id: "icpCompanySize",
    question: "What company sizes are you targeting?",
    description: "Think about employee count or revenue brackets.",
    type: "text",
    placeholder: "e.g. 10-50, 50-200, 200+",
  },
  {
    id: "icpDecisionMakerTitles",
    question: "What job titles should we reach out to?",
    description: "The decision-makers most likely to buy your service.",
    type: "textarea",
    placeholder: "e.g. CEO, CTO, VP Marketing, Head of Growth",
  },
  {
    id: "icpKeywords",
    question: "Any specific keywords, technologies or tools to target?",
    description: "Helps us narrow down leads using tech stack or keyword filters.",
    type: "textarea",
    placeholder: "e.g. Shopify, HubSpot, Series A funded",
  },
  {
    id: "icpExclusionCriteria",
    question: "Any exclusion criteria for targeting?",
    description: "Industries, company types or characteristics to avoid.",
    type: "textarea",
    placeholder: "e.g. Avoid agencies, no companies under 5 employees",
  },
  {
    id: "coreOffers",
    question: "What are your core offers or services?",
    description: "Describe what you sell and the key value proposition.",
    type: "textarea",
    required: true,
    placeholder: "e.g. We provide managed Google & Meta advertising for e-commerce brands...",
  },
  {
    id: "pricingSalesCycle",
    question: "Tell us about your pricing and sales cycle.",
    description: "Helps us craft messaging that aligns with how you sell.",
    type: "textarea",
    placeholder: "e.g. Monthly retainer from £2k/month, typical sales cycle is 2-4 weeks...",
  },
  {
    id: "differentiators",
    question: "What makes you different from competitors?",
    description: "Your competitive advantages and what sets you apart.",
    type: "textarea",
    placeholder: "e.g. We specialise in e-commerce only, 95% client retention rate...",
  },
  {
    id: "painPoints",
    question: "What pain points do your customers typically have?",
    description: "The problems your ideal customer faces before finding you.",
    type: "textarea",
    placeholder: "e.g. Wasting ad spend, can't scale beyond £50k/month, poor ROAS...",
  },
  {
    id: "caseStudies",
    question: "Do you have any case studies or social proof?",
    description: "Results, testimonials, notable clients — anything that builds trust.",
    type: "textarea",
    placeholder: "e.g. Grew Client X from £50k to £200k/month in 6 months...",
  },
  {
    id: "leadMagnets",
    question: "Do you have any lead magnets or offers to hook prospects?",
    description: "Free audits, trials, reports — anything to lower the barrier to reply.",
    type: "textarea",
    placeholder: "e.g. Free ad account audit, complimentary strategy call...",
  },
  {
    id: "existingMessaging",
    question: "Do you have any existing messaging or copy we should reference?",
    description: "Optional — any outreach copy, email templates or brand voice guidelines.",
    type: "textarea",
    placeholder: "Paste any existing copy or links here...",
  },
  {
    id: "supportingMaterials",
    question: "Any supporting materials or links?",
    description: "Case study PDFs, pitch decks, portfolio links, etc.",
    type: "textarea",
    placeholder: "e.g. https://drive.google.com/...",
  },
  {
    id: "exclusionList",
    question: "Is there an exclusion list of companies or domains to avoid?",
    description: "Existing clients, competitors, or companies you don't want us to contact.",
    type: "textarea",
    placeholder: "e.g. competitor.com, existingclient.com",
  },
  {
    id: "domains",
    question: "Select your preferred sending domains",
    description: "We'll suggest lookalike domains based on your website. Pick up to 5.",
    type: "custom",
  },
  {
    id: "targetVolume",
    question: "How many leads per month are you targeting?",
    type: "text",
    placeholder: "e.g. 500 leads/month",
  },
];
