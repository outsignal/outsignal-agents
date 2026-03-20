export interface StepField {
  id: string;
  label: string;
  type: "text" | "textarea" | "email" | "checkbox";
  required?: boolean;
  placeholder?: string;
  description?: string;
}

export interface Step {
  id: string;
  question: string;
  description?: string;
  type: "text" | "textarea" | "email" | "checkbox" | "custom";
  required?: boolean;
  placeholder?: string;
  /** Multi-field steps render all fields on one screen */
  fields?: StepField[];
}

export const ONBOARDING_STEPS: Step[] = [
  // 1. Company info
  {
    id: "company_info",
    question: "Tell us about your company",
    description: "Basic details about the company or client we'll be running campaigns for.",
    type: "custom",
    required: true,
    fields: [
      {
        id: "name",
        label: "Company or client name",
        type: "text",
        required: true,
        placeholder: "e.g. BlankTag Media",
      },
      {
        id: "vertical",
        label: "Industry or vertical",
        type: "text",
        placeholder: "e.g. SaaS, Recruitment, E-commerce",
      },
      {
        id: "website",
        label: "Website URL",
        type: "text",
        placeholder: "e.g. blanktag.co.uk",
      },
    ],
  },
  // 2. Notification emails
  {
    id: "notificationEmails",
    question: "Which email addresses should receive reply notifications?",
    description: "Comma-separated. These will be notified when a lead replies.",
    type: "text",
    placeholder: "you@company.com, colleague@company.com",
  },
  // 3. Sender info
  {
    id: "sender_info",
    question: "Who will be the sender?",
    description: "The person who will appear as the email and message sender.",
    type: "custom",
    required: true,
    fields: [
      {
        id: "senderFullName",
        label: "Full name",
        type: "text",
        required: true,
        placeholder: "e.g. James Jay",
      },
      {
        id: "senderJobTitle",
        label: "Job title",
        type: "text",
        placeholder: "e.g. Managing Director",
      },
      {
        id: "senderPhone",
        label: "Phone number",
        type: "text",
        placeholder: "e.g. +44 7XXX XXXXXX",
      },
      {
        id: "senderAddress",
        label: "Business address (for email signatures)",
        type: "textarea",
        placeholder: "123 Business St\nLondon, UK",
      },
    ],
  },
  // 4. LinkedIn sender details
  {
    id: "linkedin_info",
    question: "LinkedIn sender details",
    description: "If your package includes LinkedIn outreach, provide the sender account details. Skip if email only.",
    type: "custom",
    fields: [
      {
        id: "linkedinUsername",
        label: "LinkedIn username or email",
        type: "text",
        placeholder: "username@email.com",
      },
      {
        id: "linkedinPasswordNote",
        label: "I'll send the LinkedIn password privately via a secure channel",
        type: "checkbox",
      },
    ],
  },
  // 5. ICP targeting
  {
    id: "icp_targeting",
    question: "Who should we target?",
    description: "Define your ideal customer profile so we can find the right leads.",
    type: "custom",
    required: true,
    fields: [
      {
        id: "icpCountries",
        label: "Countries or regions",
        type: "textarea",
        placeholder: "e.g. United Kingdom, United States, Germany",
      },
      {
        id: "icpIndustries",
        label: "Industries",
        type: "textarea",
        placeholder: "e.g. Technology, Healthcare, Financial Services",
      },
      {
        id: "icpCompanySize",
        label: "Company sizes",
        type: "text",
        placeholder: "e.g. 10-50, 50-200, 200+",
      },
      {
        id: "icpDecisionMakerTitles",
        label: "Decision-maker job titles",
        type: "textarea",
        placeholder: "e.g. CEO, CTO, VP Marketing, Head of Growth",
      },
    ],
  },
  // 6. Targeting refinements
  {
    id: "icp_refinements",
    question: "Targeting refinements",
    description: "Keywords, exclusions, and companies to avoid.",
    type: "custom",
    fields: [
      {
        id: "icpKeywords",
        label: "Keywords, technologies or tools to target",
        type: "textarea",
        placeholder: "e.g. Shopify, HubSpot, Series A funded",
      },
      {
        id: "icpExclusionCriteria",
        label: "Exclusion criteria",
        type: "textarea",
        placeholder: "e.g. Avoid agencies, no companies under 5 employees",
      },
      {
        id: "exclusionList",
        label: "Exclusion list (companies or domains to avoid)",
        type: "textarea",
        placeholder: "e.g. competitor.com, existingclient.com",
      },
    ],
  },
  // 7. Offers
  {
    id: "offers",
    question: "What do you offer?",
    description: "Your core services and how you sell them.",
    type: "custom",
    required: true,
    fields: [
      {
        id: "coreOffers",
        label: "Core offers or services",
        type: "textarea",
        required: true,
        placeholder: "e.g. We provide managed Google & Meta advertising for e-commerce brands...",
      },
      {
        id: "pricingSalesCycle",
        label: "Pricing and sales cycle",
        type: "textarea",
        placeholder: "e.g. Monthly retainer from £2k/month, typical sales cycle is 2-4 weeks...",
      },
    ],
  },
  // 8. Differentiators
  {
    id: "positioning",
    question: "What makes you stand out?",
    description: "Your competitive advantages and the problems you solve.",
    type: "custom",
    fields: [
      {
        id: "differentiators",
        label: "What makes you different from competitors?",
        type: "textarea",
        placeholder: "e.g. We specialise in e-commerce only, 95% client retention rate...",
      },
      {
        id: "painPoints",
        label: "What pain points do your customers typically have?",
        type: "textarea",
        placeholder: "e.g. Wasting ad spend, can't scale beyond £50k/month, poor ROAS...",
      },
    ],
  },
  // 9. Social proof
  {
    id: "social_proof",
    question: "Social proof and hooks",
    description: "Case studies, testimonials, and lead magnets that build trust.",
    type: "custom",
    fields: [
      {
        id: "caseStudies",
        label: "Case studies or social proof",
        type: "textarea",
        placeholder: "e.g. Grew Client X from £50k to £200k/month in 6 months...",
      },
      {
        id: "leadMagnets",
        label: "Lead magnets or offers to hook prospects",
        type: "textarea",
        placeholder: "e.g. Free ad account audit, complimentary strategy call...",
      },
    ],
  },
  // 10. Existing messaging
  {
    id: "messaging",
    question: "Existing messaging and materials",
    description: "Any copy, templates, or supporting materials we should reference.",
    type: "custom",
    fields: [
      {
        id: "existingMessaging",
        label: "Existing messaging or copy",
        type: "textarea",
        placeholder: "Paste any existing copy or links here...",
      },
      {
        id: "supportingMaterials",
        label: "Supporting materials or links",
        type: "textarea",
        placeholder: "e.g. https://drive.google.com/...",
      },
    ],
  },
  // 11. Sending domains
  {
    id: "domains",
    question: "Select your preferred sending domains",
    description: "We'll suggest lookalike domains based on your website. Pick up to 5.",
    type: "custom",
  },
  // 12. Target volume
  {
    id: "targetVolume",
    question: "How many leads per month are you targeting?",
    type: "text",
    placeholder: "e.g. 500 leads/month",
  },
];
