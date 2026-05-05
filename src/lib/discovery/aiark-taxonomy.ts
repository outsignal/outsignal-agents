/**
 * AI Ark account.industry taxonomy helpers.
 *
 * The accepted labels below were verified with live AI Ark people-search probes
 * on 2026-05-05. AI Ark accepts taxonomy labels that are closer to the current
 * LinkedIn industry set than the old slash-separated LinkedIn labels:
 * e.g. "Information Technology" works, while "Information Technology and
 * Services" returns zero.
 */

export const AIARK_INDUSTRY_TAXONOMY = [
  // Marketing, media, merchandise, and consumer products
  "Marketing",
  "Advertising",
  "Advertising Services",
  "Digital Marketing",
  "Media Production",
  "Public Relations and Communications Services",
  "Retail",
  "Retail Apparel and Fashion",
  "Consumer Goods",

  // Staffing and HR
  "Staffing and Recruiting",
  "Recruiting",
  "Human Resources",
  "Human Resources Services",

  // Architecture, construction, and property
  "Architecture and Planning",
  "Construction",
  "Civil Engineering",
  "Real Estate",
  "Design Services",

  // Financial and acquisition-adjacent
  "Financial Services",
  "Investment Management",
  "Venture Capital and Private Equity Principals",
  "Capital Markets",

  // Technology and IT infrastructure
  "Information Technology",
  "IT Services and IT Consulting",
  "Software Development",
  "Enterprise Software",
  "Cloud Computing",
  "Computer Networking Products",
  "Data Storage",

  // Transport and logistics
  "Transportation",
  "Logistics",
  "Transportation, Logistics, Supply Chain and Storage",
  "Truck Transportation",
  "Warehousing",
  "Warehousing and Storage",
  "Freight and Package Transportation",
  "Maritime Transportation",
  "Airlines and Aviation",
] as const;

type AiArkIndustry = (typeof AIARK_INDUSTRY_TAXONOMY)[number];

export const AIARK_INDUSTRY_ALIASES: Record<string, readonly AiArkIndustry[]> = {
  // Marketing / ads / branded merchandise
  marketing: ["Marketing"],
  "marketing and advertising": ["Marketing", "Advertising Services", "Advertising"],
  advertising: ["Advertising Services", "Advertising"],
  "advertising services": ["Advertising Services"],
  "digital marketing": ["Digital Marketing", "Marketing", "Advertising Services"],
  media: ["Media Production"],
  "online media": ["Media Production"],
  branding: ["Marketing", "Advertising Services"],
  "brand marketing": ["Marketing", "Advertising Services"],
  "promotional products": ["Advertising Services", "Consumer Goods", "Retail"],
  "promotional merchandise": ["Advertising Services", "Consumer Goods", "Retail"],
  "branded merchandise": ["Advertising Services", "Consumer Goods", "Retail"],
  apparel: ["Retail Apparel and Fashion"],
  "apparel and fashion": ["Retail Apparel and Fashion"],
  retail: ["Retail"],
  "consumer goods": ["Consumer Goods"],

  // Recruitment / staffing / HR
  staffing: ["Staffing and Recruiting"],
  recruitment: ["Staffing and Recruiting", "Recruiting"],
  recruiting: ["Recruiting", "Staffing and Recruiting"],
  "recruitment services": ["Staffing and Recruiting", "Recruiting"],
  "recruitment agencies": ["Staffing and Recruiting", "Recruiting"],
  "recruitment agency": ["Staffing and Recruiting", "Recruiting"],
  "staffing agency": ["Staffing and Recruiting"],
  "staffing agencies": ["Staffing and Recruiting"],
  "temp agencies": ["Staffing and Recruiting"],
  "temp agency": ["Staffing and Recruiting"],
  "employment services": ["Staffing and Recruiting", "Human Resources Services"],
  "talent acquisition": ["Staffing and Recruiting", "Human Resources Services"],
  "human resources": ["Human Resources Services", "Human Resources"],

  // Architecture / construction / AEC
  aec: ["Architecture and Planning", "Construction", "Civil Engineering"],
  architecture: ["Architecture and Planning"],
  "architecture and planning": ["Architecture and Planning"],
  "architecture planning": ["Architecture and Planning"],
  "architecture project management": ["Architecture and Planning", "Construction"],
  construction: ["Construction"],
  "civil engineering": ["Civil Engineering"],
  "real estate": ["Real Estate"],
  design: ["Design Services"],
  "design services": ["Design Services"],

  // Finance / acquisitions
  "financial services": ["Financial Services"],
  "investment management": ["Investment Management"],
  "private equity": ["Venture Capital and Private Equity Principals", "Investment Management"],
  "venture capital": ["Venture Capital and Private Equity Principals"],
  "mergers and acquisitions": ["Investment Management", "Financial Services", "Capital Markets"],
  "mergers acquisitions": ["Investment Management", "Financial Services", "Capital Markets"],
  "m and a": ["Investment Management", "Financial Services", "Capital Markets"],
  acquisitions: ["Investment Management", "Financial Services"],
  "business acquisitions": ["Investment Management", "Financial Services"],
  "business brokerage": ["Financial Services"],
  "capital markets": ["Capital Markets"],

  // IT / SaaS / infrastructure
  "information technology": ["Information Technology"],
  "information technology and services": ["Information Technology", "IT Services and IT Consulting"],
  it: ["Information Technology"],
  "it services": ["IT Services and IT Consulting", "Information Technology"],
  "it services and it consulting": ["IT Services and IT Consulting"],
  "software": ["Software Development"],
  "software development": ["Software Development"],
  "computer software": ["Software Development", "Enterprise Software"],
  "b2b saas": ["Software Development", "Enterprise Software"],
  saas: ["Software Development", "Enterprise Software"],
  "enterprise software": ["Enterprise Software"],
  "cloud computing": ["Cloud Computing", "IT Services and IT Consulting"],
  "cloud services": ["Cloud Computing", "IT Services and IT Consulting"],
  "computer networking": ["Computer Networking Products"],
  networking: ["Computer Networking Products"],
  "systems integration": ["IT Services and IT Consulting"],
  "system integration": ["IT Services and IT Consulting"],
  // Important: "Data Storage" is enterprise IT, not warehousing.
  "data storage": ["Data Storage", "Information Technology"],

  // Transport / logistics
  transport: ["Transportation", "Truck Transportation"],
  transportation: ["Transportation"],
  logistics: ["Logistics", "Transportation, Logistics, Supply Chain and Storage"],
  haulage: ["Truck Transportation"],
  "road transport": ["Truck Transportation"],
  "goods transport": ["Truck Transportation", "Freight and Package Transportation"],
  trucking: ["Truck Transportation"],
  freight: ["Freight and Package Transportation"],
  "freight forwarding": [
    "Freight and Package Transportation",
    "Transportation, Logistics, Supply Chain and Storage",
  ],
  distribution: ["Logistics", "Transportation, Logistics, Supply Chain and Storage"],
  warehousing: ["Warehousing and Storage", "Warehousing"],
  warehouse: ["Warehousing and Storage", "Warehousing"],
  storage: ["Warehousing and Storage"],
  "supply chain": ["Transportation, Logistics, Supply Chain and Storage"],
  "passenger transport": ["Transportation"],
  "passenger transportation": ["Transportation"],
  maritime: ["Maritime Transportation"],
  aviation: ["Airlines and Aviation"],
};

function normalizeIndustry(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function includesIndustryToken(normalizedValue: string, token: string): boolean {
  return new RegExp(`\\b${token}\\b`).test(normalizedValue);
}

function isDigitalStorage(normalizedValue: string): boolean {
  if (!includesIndustryToken(normalizedValue, "storage")) return false;
  return [
    "cloud",
    "data",
    "database",
    "enterprise",
    "it",
    "server",
    "software",
    "technology",
  ].some((token) => includesIndustryToken(normalizedValue, token));
}

/**
 * Translate business-friendly ICP industry labels to AI Ark taxonomy values.
 * Unmapped values are deliberately skipped; the caller omits account.industry
 * entirely when no values map so the search can still return candidates.
 */
export function mapIcpIndustriesToAiArk(icpIndustries: string[]): string[] {
  const mapped: string[] = [];

  const add = (values: readonly string[]) => {
    for (const value of values) {
      if (!mapped.includes(value)) mapped.push(value);
    }
  };

  const directMatches = new Map(
    AIARK_INDUSTRY_TAXONOMY.map((value) => [normalizeIndustry(value), value]),
  );

  for (const industry of icpIndustries) {
    const normalized = normalizeIndustry(industry);
    if (!normalized) continue;

    const alias = AIARK_INDUSTRY_ALIASES[normalized];
    if (alias) {
      add(alias);
      continue;
    }

    const direct = directMatches.get(normalized);
    if (direct) {
      add([direct]);
      continue;
    }

    if (includesIndustryToken(normalized, "recruitment") || includesIndustryToken(normalized, "staffing")) {
      add(["Staffing and Recruiting", "Recruiting"]);
      continue;
    }
    if (includesIndustryToken(normalized, "marketing")) {
      add(["Marketing", "Advertising Services"]);
      continue;
    }
    if (includesIndustryToken(normalized, "advertising")) {
      add(["Advertising Services", "Advertising"]);
      continue;
    }
    if (includesIndustryToken(normalized, "architecture")) {
      add(["Architecture and Planning"]);
      continue;
    }
    if (includesIndustryToken(normalized, "construction")) {
      add(["Construction"]);
      continue;
    }
    if (includesIndustryToken(normalized, "finance") || includesIndustryToken(normalized, "financial")) {
      add(["Financial Services"]);
      continue;
    }
    if (includesIndustryToken(normalized, "saas")) {
      add(["Software Development", "Enterprise Software"]);
      continue;
    }
    if (isDigitalStorage(normalized)) {
      add(["Data Storage", "Information Technology"]);
      continue;
    }
    if (includesIndustryToken(normalized, "software")) {
      add(["Software Development"]);
      continue;
    }
    if (includesIndustryToken(normalized, "cloud")) {
      add(["Cloud Computing", "IT Services and IT Consulting"]);
      continue;
    }
    if (includesIndustryToken(normalized, "technology")) {
      add(["Information Technology"]);
      continue;
    }
    if (includesIndustryToken(normalized, "haulage")) {
      add(["Truck Transportation"]);
      continue;
    }
    if (includesIndustryToken(normalized, "freight")) {
      add(["Freight and Package Transportation", "Transportation, Logistics, Supply Chain and Storage"]);
      continue;
    }
    if (includesIndustryToken(normalized, "logistics")) {
      add(["Logistics", "Transportation, Logistics, Supply Chain and Storage"]);
      continue;
    }
    if (
      includesIndustryToken(normalized, "warehouse") ||
      includesIndustryToken(normalized, "warehousing") ||
      includesIndustryToken(normalized, "storage") ||
      includesIndustryToken(normalized, "distribution")
    ) {
      if (isDigitalStorage(normalized)) {
        add(["Data Storage", "Information Technology"]);
      } else {
        add(["Warehousing and Storage", "Transportation, Logistics, Supply Chain and Storage"]);
      }
      continue;
    }
    if (
      includesIndustryToken(normalized, "truck") ||
      includesIndustryToken(normalized, "trucking") ||
      includesIndustryToken(normalized, "transport") ||
      includesIndustryToken(normalized, "transportation")
    ) {
      add(["Transportation", "Truck Transportation"]);
      continue;
    }

    console.warn(
      `[aiark-search] Industry "${industry}" could not be mapped to AI Ark taxonomy; skipping this industry filter value.`,
    );
  }

  return mapped;
}
