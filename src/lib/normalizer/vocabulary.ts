/**
 * Controlled vocabularies for AI normalization.
 * All classifiers constrain output to these lists via Zod enum.
 */

export const CANONICAL_VERTICALS = [
  "Accounting & Finance",
  "Architecture & Construction",
  "B2B SaaS",
  "Business Acquisitions",
  "Business Services",
  "E-Commerce & Retail",
  "Education & Training",
  "Energy & Utilities",
  "Healthcare & Life Sciences",
  "HR & Recruitment",
  "Insurance",
  "Legal Services",
  "Logistics & Supply Chain",
  "Managed Services & IT",
  "Manufacturing",
  "Marketing & Advertising",
  "Media & Entertainment",
  "Professional Services",
  "Real Estate",
  "Staffing & Recruitment",
  "Telecoms",
  "Travel & Hospitality",
  "Other",
] as const;

export const SENIORITY_LEVELS = [
  "C-Suite",
  "VP",
  "Director",
  "Manager",
  "Senior IC",
  "IC",
  "Entry Level",
  "Unknown",
] as const;

export type CanonicalVertical = (typeof CANONICAL_VERTICALS)[number];
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];
