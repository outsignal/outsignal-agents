/**
 * Discovery pipeline quality gate filters.
 *
 * Pre-search domain coverage check, ICP title filtering, and company-type
 * filtering. Pure functions except getUncoveredDomains (DB query).
 */

import { prisma } from "@/lib/db";
import { expandCountryTerms } from "./country-codes";
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

export type TitleRejectionReason =
  | "missing_title"
  | "junk_title"
  | "out_of_scope_title";

export interface TitleFilterOptions {
  /** Strict target titles from the resolved ICP/request scope. Empty disables strict title matching. */
  targetTitles?: string[];
  /** Future escape hatch for known-good variants; intentionally empty by default. */
  allowedTitleVariants?: string[];
}

export interface TitleFilterRejection {
  person: DiscoveredPersonResult;
  reason: TitleRejectionReason;
}

export interface DiscoveryFilterRejectionLogInput {
  provider: string;
  workspaceSlug: string;
  discoveryRunId?: string | null;
  icpProfileId?: string | null;
  campaignId?: string | null;
  targetListId?: string | null;
  targetTitles?: string[];
  rejections: TitleFilterRejection[];
}

function normaliseTitleForMatch(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsAtWordBoundary(haystack: string, needle: string): boolean {
  const pattern = new RegExp(`(^|\\b)${escapeRegExp(needle)}(\\b|$)`, "i");
  return pattern.test(haystack);
}

function meaningfulTitleTokens(value: string): string[] {
  const stopWords = new Set(["and", "of", "the", "for", "to", "in", "at", "&"]);
  return normaliseTitleForMatch(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !stopWords.has(token));
}

function titleHasStructuralStopword(value: string): boolean {
  return /\b(and|of|for|to|in|at|&)\b/i.test(value);
}

function containsMeaningfulTokensInOrder(title: string, targetTitle: string): boolean {
  if (!titleHasStructuralStopword(targetTitle)) return false;

  const titleTokens = meaningfulTitleTokens(title);
  const targetTokens = meaningfulTitleTokens(targetTitle);
  if (targetTokens.length < 2) return false;

  let cursor = 0;
  for (const token of titleTokens) {
    if (token === targetTokens[cursor]) {
      cursor++;
      if (cursor === targetTokens.length) return true;
    }
  }
  return false;
}

function matchesTwoTokenOfReversal(title: string, targetTitle: string): boolean {
  const titleTokens = meaningfulTitleTokens(title);
  const targetTokens = meaningfulTitleTokens(targetTitle);
  if (titleTokens.length !== 2 || targetTokens.length !== 2) return false;
  if (titleTokens[0] !== targetTokens[1] || titleTokens[1] !== targetTokens[0]) {
    return false;
  }

  const reversedPhrase = `${escapeRegExp(targetTokens[1])}\\s+of\\s+${escapeRegExp(targetTokens[0])}`;
  return new RegExp(`(^|\\b)${reversedPhrase}(\\b|$)`, "i").test(title);
}

export function titleMatchesTarget(
  discoveredTitle: string | null | undefined,
  targetTitles: string[] = [],
  allowedTitleVariants: string[] = [],
): boolean {
  const title = discoveredTitle?.trim();
  if (!title) return false;

  const candidates = [...targetTitles, ...allowedTitleVariants]
    .map((value) => value.trim())
    .filter(Boolean);
  if (candidates.length === 0) return true;

  const normalisedTitle = normaliseTitleForMatch(title);
  const discoveredTokenCount = meaningfulTitleTokens(normalisedTitle).length;

  return candidates.some((candidate) => {
    const normalisedCandidate = normaliseTitleForMatch(candidate);
    return (
      normalisedTitle === normalisedCandidate ||
      containsAtWordBoundary(normalisedTitle, normalisedCandidate) ||
      (discoveredTokenCount >= 2 && containsAtWordBoundary(normalisedCandidate, normalisedTitle)) ||
      containsMeaningfulTokensInOrder(normalisedTitle, normalisedCandidate) ||
      matchesTwoTokenOfReversal(normalisedTitle, normalisedCandidate)
    );
  });
}

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
  options: TitleFilterOptions = {},
): {
  passed: DiscoveredPersonResult[];
  filtered: DiscoveredPersonResult[];
  rejections: TitleFilterRejection[];
} {
  const passed: DiscoveredPersonResult[] = [];
  const filtered: DiscoveredPersonResult[] = [];
  const rejections: TitleFilterRejection[] = [];
  const targetTitles = options.targetTitles?.filter((title) => title.trim()) ?? [];
  const strictTitleMatch = targetTitles.length > 0;

  for (const person of people) {
    const jobTitle = person.jobTitle?.trim();
    let reason: TitleRejectionReason | null = null;

    if (strictTitleMatch && !jobTitle) {
      reason = "missing_title";
    } else if (jobTitle && isJunkTitle(jobTitle)) {
      reason = "junk_title";
    } else if (
      strictTitleMatch &&
      !titleMatchesTarget(jobTitle, targetTitles, options.allowedTitleVariants)
    ) {
      reason = "out_of_scope_title";
    }

    if (reason) {
      filtered.push(person);
      rejections.push({ person, reason });
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

  return { passed, filtered, rejections };
}

export async function logDiscoveryTitleRejections(
  input: DiscoveryFilterRejectionLogInput,
): Promise<void> {
  if (input.rejections.length === 0) return;

  await prisma.discoveryRejectionLog.createMany({
    data: input.rejections.map(({ person, reason }) => ({
      provider: input.provider,
      workspaceSlug: input.workspaceSlug,
      discoveryRunId: input.discoveryRunId ?? null,
      icpProfileId: input.icpProfileId ?? null,
      campaignId: input.campaignId ?? null,
      targetListId: input.targetListId ?? null,
      originalTitle: person.jobTitle ?? null,
      targetTitles: input.targetTitles ?? [],
      reason,
      personName: [person.firstName, person.lastName].filter(Boolean).join(" ") || null,
      company: person.company ?? null,
    })),
  });
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
  titleFilterOptions?: TitleFilterOptions,
): {
  passed: DiscoveredPersonResult[];
  titleFiltered: number;
  companyFiltered: number;
  locationFiltered: number;
  totalFiltered: number;
  titleRejections: TitleFilterRejection[];
} {
  const titleResult = filterByTitle(people, titleFilterOptions);
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
    titleRejections: titleResult.rejections,
  };
}
