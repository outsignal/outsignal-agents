/**
 * Discovery pipeline quality gate filters.
 *
 * Pre-search domain coverage check, ICP title filtering, and company-type
 * filtering. Pure functions except getUncoveredDomains (DB query).
 */

import { prisma } from "@/lib/db";
import type { DiscoveredPersonResult } from "./types";

// ---------------------------------------------------------------------------
// 1. Pre-search domain coverage check
// ---------------------------------------------------------------------------

/**
 * Query DiscoveredPerson for domains already covered in this workspace,
 * and return only the gap domains that have no existing records.
 *
 * @param workspaceSlug - The workspace to check coverage for
 * @param domains - Array of domains to check
 * @returns Only domains that do NOT have any DiscoveredPerson records yet
 */
export async function getUncoveredDomains(
  workspaceSlug: string,
  domains: string[],
): Promise<string[]> {
  if (domains.length === 0) return [];

  // Normalise to lowercase for consistent matching
  const normalised = domains.map((d) => d.toLowerCase());

  // Query existing coverage — find distinct companyDomains that already have
  // staged or promoted records for this workspace
  const covered = await prisma.discoveredPerson.findMany({
    where: {
      workspaceSlug,
      companyDomain: { in: normalised },
      status: { in: ["staged", "promoted"] },
    },
    select: { companyDomain: true },
    distinct: ["companyDomain"],
  });

  const coveredSet = new Set(
    covered.map((r) => r.companyDomain?.toLowerCase()).filter(Boolean),
  );

  const uncovered = normalised.filter((d) => !coveredSet.has(d));

  if (coveredSet.size > 0) {
    console.log(
      `[discovery-filters] Domain coverage check: ${coveredSet.size} already covered, ${uncovered.length} uncovered out of ${domains.length} total`,
    );
  }

  // Return original casing for uncovered domains
  return domains.filter((d) => !coveredSet.has(d.toLowerCase()));
}

// ---------------------------------------------------------------------------
// 2. ICP title filtering
// ---------------------------------------------------------------------------

/**
 * Junk job titles that should ALWAYS be excluded from discovery results
 * regardless of ICP. Case-insensitive matching.
 */
const JUNK_TITLES: string[] = [
  "volunteer",
  "board member",
  "photographer",
  "cartoonist",
  "writer",
  "editor",
  "journalist",
  "intern",
  "stylist",
  "supervisor",
  "key holder",
  "jeweller",
  "processor",
  "scholar",
  "contributor",
];

/**
 * Content-related titles that are acceptable exceptions to the "writer"
 * and "editor" exclusions.
 */
const CONTENT_ROLE_EXCEPTIONS: RegExp[] = [
  /content\s+writer/i,
  /content\s+editor/i,
  /copywriter/i,
  /technical\s+writer/i,
  /content\s+manager/i,
  /content\s+strategist/i,
  /editor[\s-]in[\s-]chief/i,
  /managing\s+editor/i,
];

/**
 * Check if a job title matches any junk title pattern.
 * Returns true if the title should be EXCLUDED.
 */
function isJunkTitle(title: string): boolean {
  const lower = title.toLowerCase().trim();

  for (const junk of JUNK_TITLES) {
    // Exact match or the title starts/ends with the junk pattern
    if (lower === junk || lower.startsWith(junk + " ") || lower.endsWith(" " + junk)) {
      // Check for content role exceptions
      if ((junk === "writer" || junk === "editor") &&
          CONTENT_ROLE_EXCEPTIONS.some((re) => re.test(title))) {
        return false;
      }
      return true;
    }
  }

  return false;
}

/**
 * Filter discovered people by ICP title relevance.
 * Removes contacts with junk titles. Logs filtered-out contacts.
 *
 * @param people - Array of discovered people
 * @returns Object with passed (ICP-matching) and filtered (non-matching) arrays
 */
export function filterByTitle(
  people: DiscoveredPersonResult[],
): { passed: DiscoveredPersonResult[]; filtered: DiscoveredPersonResult[] } {
  const passed: DiscoveredPersonResult[] = [];
  const filtered: DiscoveredPersonResult[] = [];

  for (const person of people) {
    if (person.jobTitle && isJunkTitle(person.jobTitle)) {
      filtered.push(person);
    } else {
      passed.push(person);
    }
  }

  if (filtered.length > 0) {
    const examples = filtered
      .slice(0, 5)
      .map((p) => `${p.firstName ?? ""} ${p.lastName ?? ""} — ${p.jobTitle}`)
      .join("; ");
    console.log(
      `[discovery-filters] Title filter: ${filtered.length} excluded (${passed.length} passed). Examples: ${examples}`,
    );
  }

  return { passed, filtered };
}

// ---------------------------------------------------------------------------
// 3. Company-type filtering
// ---------------------------------------------------------------------------

/**
 * Company name patterns that indicate off-ICP organisations.
 * Case-insensitive matching.
 */
const OFF_ICP_COMPANY_PATTERNS: RegExp[] = [
  // Non-profits and charities
  /\bcharity\b/i,
  /\bcharitable\b/i,
  /\bnon[\s-]?profit\b/i,
  /\bngo\b/i,
  /\bfoundation\b/i,
  /\btrust\b/i,

  // Government
  /\bcouncil\b/i,
  /\bgovernment\b/i,
  /\bparliament\b/i,
  /\bministry\b/i,
  /\bnhs\b/i,
  /\bpublic\s+sector\b/i,
  /\bcivil\s+service\b/i,

  // Media/publishing (unless ICP targets them)
  /\bnewspaper\b/i,
  /\bbroadcasting\b/i,
];

/**
 * Industry classifications that are typically off-ICP.
 */
const OFF_ICP_INDUSTRIES = new Set([
  "non-profit",
  "nonprofit",
  "non profit",
  "charity",
  "government",
  "government administration",
  "public administration",
  "legislative office",
  "political organization",
  "philanthropy",
]);

/**
 * FTSE 100 / very large enterprise threshold.
 * Companies above this employee count are excluded unless ICP targets enterprise.
 */
const ENTERPRISE_EMPLOYEE_THRESHOLD = 10_000;

export interface CompanyFilterOptions {
  /** If true, allow enterprise/FTSE 100 companies through */
  allowEnterprise?: boolean;
  /** If true, allow non-profits through */
  allowNonProfit?: boolean;
  /** If true, allow government organisations through */
  allowGovernment?: boolean;
}

/**
 * Check if a person's company appears to be off-ICP based on company name,
 * industry signals, or size.
 *
 * NOTE: This is a heuristic filter. It uses available data from the
 * DiscoveredPersonResult (company name only — no industry or employee count
 * fields). For more accurate filtering, use the full Company record after
 * enrichment.
 */
export function filterByCompanyType(
  people: DiscoveredPersonResult[],
  options: CompanyFilterOptions = {},
): { passed: DiscoveredPersonResult[]; filtered: DiscoveredPersonResult[] } {
  const passed: DiscoveredPersonResult[] = [];
  const filtered: DiscoveredPersonResult[] = [];

  for (const person of people) {
    const company = person.company ?? "";
    let excluded = false;

    // Check company name patterns
    if (!options.allowNonProfit) {
      if (/\bcharity\b/i.test(company) ||
          /\bcharitable\b/i.test(company) ||
          /\bnon[\s-]?profit\b/i.test(company) ||
          /\bngo\b/i.test(company) ||
          /\bfoundation\b/i.test(company)) {
        excluded = true;
      }
    }

    if (!options.allowGovernment) {
      if (/\bcouncil\b/i.test(company) ||
          /\bgovernment\b/i.test(company) ||
          /\bparliament\b/i.test(company) ||
          /\bministry\b/i.test(company) ||
          /\bnhs\b/i.test(company) ||
          /\bpublic\s+sector\b/i.test(company) ||
          /\bcivil\s+service\b/i.test(company)) {
        excluded = true;
      }
    }

    if (excluded) {
      filtered.push(person);
    } else {
      passed.push(person);
    }
  }

  if (filtered.length > 0) {
    const examples = filtered
      .slice(0, 5)
      .map((p) => `${p.company ?? "unknown"}`)
      .join("; ");
    console.log(
      `[discovery-filters] Company filter: ${filtered.length} excluded (${passed.length} passed). Examples: ${examples}`,
    );
  }

  return { passed, filtered };
}

// ---------------------------------------------------------------------------
// 4. Post-search location filter
// ---------------------------------------------------------------------------

/**
 * Country name aliases — maps common codes/abbreviations to their canonical names
 * and vice versa. Used for lenient matching so "UK", "GB", and "United Kingdom"
 * all resolve to the same country.
 */
const COUNTRY_ALIASES: Record<string, string[]> = {
  "united kingdom": ["uk", "gb", "great britain", "england", "scotland", "wales", "northern ireland"],
  "united states": ["us", "usa", "united states of america", "america"],
  "australia": ["au", "aus"],
  "canada": ["ca", "can"],
  "germany": ["de", "deu", "deutschland"],
  "france": ["fr", "fra"],
  "netherlands": ["nl", "nld", "holland"],
  "ireland": ["ie", "irl", "republic of ireland"],
  "spain": ["es", "esp"],
  "italy": ["it", "ita"],
  "sweden": ["se", "swe"],
  "norway": ["no", "nor"],
  "denmark": ["dk", "dnk"],
  "finland": ["fi", "fin"],
  "belgium": ["be", "bel"],
  "switzerland": ["ch", "che"],
  "singapore": ["sg", "sgp"],
  "new zealand": ["nz", "nzl"],
};

/**
 * Normalise a location string or expected country token to a set of lowercase
 * terms that can be matched against. Strips Prospeo's "#CC" suffix and
 * expands abbreviations via COUNTRY_ALIASES.
 */
function expandCountryTerms(token: string): Set<string> {
  // Strip Prospeo's " #CC" suffix (e.g. "United Kingdom #GB" -> "United Kingdom")
  const stripped = token.replace(/\s*#[A-Z]{2,3}$/, "").toLowerCase().trim();
  const terms = new Set<string>([stripped]);

  // Add all aliases for this canonical name
  const aliases = COUNTRY_ALIASES[stripped];
  if (aliases) {
    for (const alias of aliases) {
      terms.add(alias);
    }
  }

  // Also check if the stripped value IS an alias — resolve to canonical + its aliases
  for (const [canonical, aliasList] of Object.entries(COUNTRY_ALIASES)) {
    if (aliasList.includes(stripped)) {
      terms.add(canonical);
      for (const alias of aliasList) {
        terms.add(alias);
      }
      break;
    }
  }

  return terms;
}

/**
 * Check whether a person's location string matches any of the expected country terms.
 * Matching is lenient — partial substring match is allowed (e.g. "London, United Kingdom"
 * will match if "United Kingdom" or "UK" is in the expected list).
 */
function locationMatchesExpected(
  personLocation: string,
  expectedTermSets: Set<string>[],
): boolean {
  const loc = personLocation.toLowerCase();

  for (const termSet of expectedTermSets) {
    for (const term of termSet) {
      if (loc.includes(term)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filter discovered people by expected country/location.
 *
 * - Accepts country names, ISO codes, or Prospeo-format strings ("United Kingdom #GB")
 * - Matching is case-insensitive and partial ("London, United Kingdom" matches "UK")
 * - If `expectedCountries` is empty or omitted, all people pass through (no-op)
 *
 * @param people - Discovered people to filter
 * @param expectedCountries - Accepted country names/codes. Pass empty array to disable.
 * @returns Object with passed (location-matching) and filtered (non-matching) arrays
 */
export function filterByLocation(
  people: DiscoveredPersonResult[],
  expectedCountries: string[] = [],
): { passed: DiscoveredPersonResult[]; filtered: DiscoveredPersonResult[] } {
  // No-op if no countries specified
  if (expectedCountries.length === 0) {
    return { passed: people, filtered: [] };
  }

  // Pre-expand all expected country tokens once
  const expectedTermSets = expectedCountries.map(expandCountryTerms);

  const passed: DiscoveredPersonResult[] = [];
  const filtered: DiscoveredPersonResult[] = [];

  for (const person of people) {
    if (!person.location) {
      // No location data — pass through (cannot reject what we cannot verify)
      passed.push(person);
      continue;
    }

    if (locationMatchesExpected(person.location, expectedTermSets)) {
      passed.push(person);
    } else {
      filtered.push(person);
    }
  }

  if (filtered.length > 0) {
    const examples = filtered
      .slice(0, 5)
      .map((p) => `${p.firstName ?? ""} ${p.lastName ?? ""} — ${p.location}`)
      .join("; ");
    console.log(
      `[discovery-filters] Location filter: ${filtered.length} excluded (${passed.length} passed). Expected: [${expectedCountries.join(", ")}]. Examples: ${examples}`,
    );
  }

  return { passed, filtered };
}

// ---------------------------------------------------------------------------
// 5. Combined filter pipeline
// ---------------------------------------------------------------------------

/**
 * Run all discovery filters in sequence: title filter, then company-type filter,
 * then location filter.
 * Returns the passing people and a summary of what was filtered.
 */
export function applyDiscoveryFilters(
  people: DiscoveredPersonResult[],
  companyFilterOptions?: CompanyFilterOptions,
  expectedCountries?: string[],
): {
  passed: DiscoveredPersonResult[];
  titleFiltered: number;
  companyFiltered: number;
  locationFiltered: number;
  totalFiltered: number;
} {
  const titleResult = filterByTitle(people);
  const companyResult = filterByCompanyType(titleResult.passed, companyFilterOptions);
  const locationResult = filterByLocation(companyResult.passed, expectedCountries);

  return {
    passed: locationResult.passed,
    titleFiltered: titleResult.filtered.length,
    companyFiltered: companyResult.filtered.length,
    locationFiltered: locationResult.filtered.length,
    totalFiltered:
      titleResult.filtered.length +
      companyResult.filtered.length +
      locationResult.filtered.length,
  };
}
