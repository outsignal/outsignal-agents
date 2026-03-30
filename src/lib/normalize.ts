/**
 * Normalize a company name to consistent title case, with special handling
 * for acronyms, domain suffixes, and hyphenated names.
 */
export function normalizeCompanyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;

  // If 4 chars or fewer and all uppercase, keep as-is (acronyms like DHL, VGS, RTA)
  if (trimmed.length <= 4 && trimmed === trimmed.toUpperCase()) {
    return trimmed;
  }

  // Domain suffixes to preserve as-is
  const domainSuffixes = [".com", ".ai", ".io", ".co"];

  // Check if name ends with a domain suffix
  let suffix = "";
  let base = trimmed;
  for (const ds of domainSuffixes) {
    if (trimmed.toLowerCase().endsWith(ds)) {
      suffix = ds;
      base = trimmed.slice(0, -ds.length);
      break;
    }
  }

  const isAllLower = base === base.toLowerCase();
  const isAllUpper = base === base.toUpperCase();

  // Only convert if all-lowercase or all-uppercase (5+ chars since <=4 uppercase handled above)
  if (!isAllLower && !isAllUpper) {
    // Mixed case: preserve original casing, just return trimmed
    return trimmed;
  }

  // Convert base to title case, preserving casing after hyphens for originally mixed segments
  const words = base.split(/(\s+)/); // split but keep whitespace
  const titleCased = words.map((word) => {
    if (/^\s+$/.test(word)) return word; // preserve whitespace segments

    // Handle hyphenated words: title-case each segment independently
    const parts = word.split(/(-)/);
    return parts
      .map((part) => {
        if (part === "-") return part;
        if (part.length === 0) return part;
        // Preserve special characters like ®
        const firstAlpha = part.search(/[a-zA-Z]/);
        if (firstAlpha === -1) return part; // no alpha chars, keep as-is
        return (
          part.slice(0, firstAlpha) +
          part.charAt(firstAlpha).toUpperCase() +
          part.slice(firstAlpha + 1).toLowerCase()
        );
      })
      .join("");
  });

  return titleCased.join("") + suffix;
}

// ---------------------------------------------------------------------------
// Job Title Normalisation
// ---------------------------------------------------------------------------

const CSUITE_ACRONYMS = new Set([
  "ceo", "cto", "cfo", "coo", "cio", "cmo", "cso", "cpo", "cro", "chro",
]);

const VP_PATTERN = /^vp\b/i;

/**
 * Normalise a job title to consistent casing.
 *
 * - C-suite acronyms: "cto" -> "CTO"
 * - VP prefix: "vp of sales" -> "VP of Sales"
 * - Title case otherwise: "head of marketing" -> "Head of Marketing"
 * - Preserves existing mixed case: "DevOps Engineer" stays as-is
 */
export function normalizeJobTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;

  // Check for C-suite acronyms (exact match after lowering)
  if (CSUITE_ACRONYMS.has(trimmed.toLowerCase())) {
    return trimmed.toUpperCase();
  }

  const isAllLower = trimmed === trimmed.toLowerCase();
  const isAllUpper = trimmed === trimmed.toUpperCase();

  // If mixed case already, preserve it
  if (!isAllLower && !isAllUpper) {
    return trimmed;
  }

  // Handle VP prefix
  if (VP_PATTERN.test(trimmed)) {
    const rest = trimmed.slice(2);
    return "VP" + titleCaseWords(rest);
  }

  return titleCaseWords(trimmed);
}

// ---------------------------------------------------------------------------
// Location Normalisation
// ---------------------------------------------------------------------------

const COUNTRY_CODES = new Set([
  "UK", "US", "USA", "UAE", "EU", "CA", "AU", "NZ", "IE", "DE", "FR", "NL",
  "BE", "CH", "AT", "ES", "IT", "PT", "SE", "NO", "DK", "FI", "PL", "CZ",
  "HK", "SG", "JP", "KR", "IN", "BR", "MX", "ZA", "GB", "IL",
]);

/**
 * Normalise a location string to consistent casing.
 *
 * - Title case each word: "london, uk" -> "London, UK"
 * - Preserves 2-3 letter uppercase tokens as country codes
 */
export function normalizeLocation(location: string): string {
  const trimmed = location.trim();
  if (!trimmed) return trimmed;

  // Split by spaces and commas, preserving separators
  return trimmed.replace(/[^\s,]+/g, (word) => {
    // If it's a 2-3 letter token and matches a known country code, uppercase it
    if (word.length >= 2 && word.length <= 3 && COUNTRY_CODES.has(word.toUpperCase())) {
      return word.toUpperCase();
    }
    // Title case the word
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

// ---------------------------------------------------------------------------
// Industry Normalisation
// ---------------------------------------------------------------------------

const KNOWN_ABBREVIATIONS: Record<string, string> = {
  saas: "SaaS",
  b2b: "B2B",
  b2c: "B2C",
  ai: "AI",
  it: "IT",
  hr: "HR",
  pr: "PR",
  iot: "IoT",
  api: "API",
  crm: "CRM",
  erp: "ERP",
  vpn: "VPN",
  seo: "SEO",
  sem: "SEM",
  dtc: "DTC",
  d2c: "D2C",
};

/**
 * Normalise an industry string to consistent casing.
 *
 * - Known abbreviations: "SAAS" -> "SaaS", "b2b" -> "B2B"
 * - Title case remaining words: "b2b software" -> "B2B Software"
 */
export function normalizeIndustry(industry: string): string {
  const trimmed = industry.trim();
  if (!trimmed) return trimmed;

  return trimmed.replace(/[^\s,&/]+/g, (word) => {
    const lower = word.toLowerCase();
    if (KNOWN_ABBREVIATIONS[lower]) {
      return KNOWN_ABBREVIATIONS[lower];
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

// ---------------------------------------------------------------------------
// Shared helper: title case a string
// ---------------------------------------------------------------------------

const LOWERCASE_WORDS = new Set(["of", "the", "and", "in", "for", "to", "a", "an", "at", "by", "on", "or"]);

function titleCaseWords(text: string): string {
  return text.replace(/[^\s]+/g, (word, offset: number) => {
    const lower = word.toLowerCase();
    // Keep lowercase words like "of", "the" unless first word
    if (offset > 0 && LOWERCASE_WORDS.has(lower)) {
      return lower;
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}
