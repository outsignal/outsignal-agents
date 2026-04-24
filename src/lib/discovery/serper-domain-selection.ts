import {
  SERPER_COMPANY_SUFFIX_TOKENS,
  SERPER_FUZZY_MATCH_THRESHOLD,
  SERPER_FULL_TITLE_MATCH_BONUS,
  SERPER_HARD_SKIP_DOMAINS,
  SERPER_KEYWORD_SCORE_WEIGHT,
  SERPER_MIN_DISTINCTIVE_TOKEN_MATCHES,
  SERPER_NON_UK_TLD_COUNTRY_HINTS,
  SERPER_NON_UK_TLDS,
  SERPER_PARTIAL_TITLE_MATCH_BONUS,
  SERPER_PREFERRED_UK_TLD_SCORES,
  SERPER_QUERY_EXCLUDED_SITES,
  SERPER_RESULT_SCORE_THRESHOLD,
  SERPER_RETRY_BUDGET,
} from "./serper-config";

export interface SerperWebSearchContext {
  companyName: string;
  contextKeywords?: string[];
  location?: string;
  gl?: string;
  hl?: string;
}

export interface SerperWebResultLike {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

export interface SerperRankedCandidate {
  domain: string;
  domainRoot: string;
  score: number;
  fuzzyScore: number;
  tokenScore: number;
  keywordHits: string[];
  titleMatchScore: number;
  tldScore: number;
  distinctiveTokenMatches: string[];
  result: SerperWebResultLike;
  rejectionReason?: never;
}

export interface SerperRejectedCandidate {
  domain: string | null;
  domainRoot: string | null;
  score: number;
  fuzzyScore: number;
  tokenScore: number;
  keywordHits: string[];
  titleMatchScore: number;
  tldScore: number;
  distinctiveTokenMatches: string[];
  result: SerperWebResultLike;
  rejectionReason:
    | "invalid_url"
    | "hard_skip_domain"
    | "non_uk_tld"
    | "fuzzy_threshold"
    | "distinctive_token_miss"
    | "score_threshold";
}

export interface SerperQueryAttempt {
  query: string;
  gl?: string;
  hl?: string;
}

const NON_DISTINCTIVE_TOKENS = new Set([
  ...SERPER_COMPANY_SUFFIX_TOKENS,
  "and",
  "the",
  "uk",
  "transport",
  "logistics",
  "haulage",
  "freight",
  "carrier",
  "carriers",
  "services",
  "service",
  "group",
  "solutions",
  "holding",
  "holdings",
]);

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n];
}

function stringSimilarityPercent(a: string, b: string): number {
  const left = a.replace(/\s+/g, "");
  const right = b.replace(/\s+/g, "");
  const maxLen = Math.max(left.length, right.length);
  if (maxLen === 0) return 100;
  return Math.round((1 - levenshteinDistance(left, right) / maxLen) * 100);
}

export function normalizeCompanyNameForDomainMatch(companyName: string): string {
  const suffixPattern = new RegExp(
    `\\b(?:${SERPER_COMPANY_SUFFIX_TOKENS.map((token) => token.replace("/", "\\/")).join("|")})\\b`,
    "gi",
  );

  return companyName
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/\./g, " ")
    .replace(suffixPattern, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractDomainFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function extractDomainRoot(domain: string): string {
  const parts = domain.replace(/^www\./, "").toLowerCase().split(".");
  if (parts.length <= 2) {
    return parts[0] ?? domain.toLowerCase();
  }

  const secondLevelSuffix = parts.at(-2);
  if (secondLevelSuffix && ["co", "org", "gov", "ac"].includes(secondLevelSuffix)) {
    return parts.at(-3) ?? parts[0];
  }

  return parts.at(-2) ?? parts[0];
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueKeywords(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function getCompanyTokens(companyName: string): string[] {
  return normalizeCompanyNameForDomainMatch(companyName)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function getDistinctiveCompanyTokens(
  companyName: string,
  contextKeywords: string[],
): string[] {
  const contextSet = new Set(contextKeywords.map((keyword) => normalizeText(keyword)));

  return getCompanyTokens(companyName).filter((token) => {
    if (token.length < 3) return false;
    if (NON_DISTINCTIVE_TOKENS.has(token)) return false;
    if (contextSet.has(token)) return false;
    return true;
  });
}

function computeTokenScore(companyName: string, domainRoot: string): number {
  const companyTokens = getCompanyTokens(companyName).filter((token) => token.length >= 4);
  if (companyTokens.length === 0) return 0;

  const domainTokens = normalizeText(domainRoot).split(" ").filter(Boolean);
  const exactMatches = companyTokens.filter((token) => domainTokens.includes(token)).length;
  const substringMatches = companyTokens.filter((token) => domainRoot.includes(token)).length;
  const best = Math.max(exactMatches, substringMatches);

  return Math.round((best / companyTokens.length) * 100);
}

function getTldScore(domain: string): number {
  if (domain.endsWith(".co.uk")) return SERPER_PREFERRED_UK_TLD_SCORES[".co.uk"];
  if (domain.endsWith(".uk")) return SERPER_PREFERRED_UK_TLD_SCORES[".uk"];
  if (domain.endsWith(".com")) return SERPER_PREFERRED_UK_TLD_SCORES[".com"];
  return SERPER_PREFERRED_UK_TLD_SCORES.default;
}

function isHardSkipDomain(domain: string): boolean {
  return SERPER_HARD_SKIP_DOMAINS.some(
    (skipDomain) => domain === skipDomain || domain.endsWith(`.${skipDomain}`),
  );
}

function isNonUkTldRejected(domain: string, companyName: string): boolean {
  const lowerCompany = companyName.toLowerCase();

  return SERPER_NON_UK_TLDS.some((suffix) => {
    if (!domain.endsWith(suffix)) return false;
    const countryHints = SERPER_NON_UK_TLD_COUNTRY_HINTS[suffix] ?? [];
    return !countryHints.some((hint) => lowerCompany.includes(hint));
  });
}

function getKeywordHits(
  result: SerperWebResultLike,
  contextKeywords: string[],
): string[] {
  if (contextKeywords.length === 0) return [];

  const haystack = normalizeText(`${result.title} ${result.snippet} ${result.link}`);
  return contextKeywords.filter((keyword) => haystack.includes(normalizeText(keyword)));
}

function getTitleMatchScore(
  companyName: string,
  result: SerperWebResultLike,
): number {
  const companyTokens = getCompanyTokens(companyName).filter((token) => token.length >= 4);
  if (companyTokens.length === 0) return 0;

  const haystack = normalizeText(`${result.title} ${result.snippet}`);
  const matchedTokens = companyTokens.filter((token) => haystack.includes(token)).length;

  if (matchedTokens === companyTokens.length) return SERPER_FULL_TITLE_MATCH_BONUS;
  if (matchedTokens > 0) return SERPER_PARTIAL_TITLE_MATCH_BONUS;
  return 0;
}

function getDistinctiveTokenMatches(
  companyName: string,
  contextKeywords: string[],
  domainRoot: string,
  result: SerperWebResultLike,
): string[] {
  const distinctiveTokens = getDistinctiveCompanyTokens(companyName, contextKeywords);
  if (distinctiveTokens.length === 0) return [];

  const haystack = `${domainRoot} ${normalizeText(result.title)} ${normalizeText(result.snippet)}`;
  return distinctiveTokens.filter((token) => haystack.includes(token));
}

export function computeDomainFuzzyScore(companyName: string, domain: string): number {
  const normalizedCompany = normalizeCompanyNameForDomainMatch(companyName);
  const domainRoot = extractDomainRoot(domain);
  const domainSimilarity = stringSimilarityPercent(normalizedCompany, domainRoot);
  const tokenScore = computeTokenScore(companyName, domainRoot);
  return Math.max(domainSimilarity, tokenScore);
}

export function buildSerperCompanyQuery(
  companyName: string,
  options: { contextKeywords?: string[]; location?: string } = {},
): string {
  const contextKeywords = uniqueKeywords(options.contextKeywords ?? []);
  const queryParts = [`"${companyName}"`];

  if (options.location?.trim()) {
    queryParts.push(`"${options.location.trim()}"`);
  }

  if (contextKeywords.length > 0) {
    queryParts.push(`(${contextKeywords.join(" OR ")})`);
  }

  for (const site of SERPER_QUERY_EXCLUDED_SITES) {
    queryParts.push(`-site:${site}`);
  }

  return queryParts.join(" ");
}

export function buildSerperQueryAttempts(
  context: SerperWebSearchContext,
): SerperQueryAttempt[] {
  const contextKeywords = uniqueKeywords(context.contextKeywords ?? []);
  const queries: SerperQueryAttempt[] = [];
  const seen = new Set<string>();
  const locations = [context.location?.trim() || null, null];

  for (const location of locations) {
    if (queries.length >= SERPER_RETRY_BUDGET) break;
    const query = buildSerperCompanyQuery(context.companyName, {
      contextKeywords,
      location: location ?? undefined,
    });
    if (seen.has(query)) continue;
    seen.add(query);
    queries.push({ query, gl: context.gl, hl: context.hl });
  }

  return queries;
}

export function evaluateSerperDomainCandidate(
  result: SerperWebResultLike,
  context: Pick<SerperWebSearchContext, "companyName" | "contextKeywords">,
): SerperRankedCandidate | SerperRejectedCandidate {
  const domain = extractDomainFromUrl(result.link);
  if (!domain) {
    return {
      domain: null,
      domainRoot: null,
      score: 0,
      fuzzyScore: 0,
      tokenScore: 0,
      keywordHits: [],
      titleMatchScore: 0,
      tldScore: 0,
      distinctiveTokenMatches: [],
      result,
      rejectionReason: "invalid_url",
    };
  }

  if (isHardSkipDomain(domain)) {
    return {
      domain,
      domainRoot: extractDomainRoot(domain),
      score: 0,
      fuzzyScore: 0,
      tokenScore: 0,
      keywordHits: [],
      titleMatchScore: 0,
      tldScore: 0,
      distinctiveTokenMatches: [],
      result,
      rejectionReason: "hard_skip_domain",
    };
  }

  if (isNonUkTldRejected(domain, context.companyName)) {
    return {
      domain,
      domainRoot: extractDomainRoot(domain),
      score: 0,
      fuzzyScore: 0,
      tokenScore: 0,
      keywordHits: [],
      titleMatchScore: 0,
      tldScore: 0,
      distinctiveTokenMatches: [],
      result,
      rejectionReason: "non_uk_tld",
    };
  }

  const contextKeywords = uniqueKeywords(context.contextKeywords ?? []);
  const domainRoot = extractDomainRoot(domain);
  const normalizedCompany = normalizeCompanyNameForDomainMatch(context.companyName);
  const domainSimilarity = stringSimilarityPercent(normalizedCompany, domainRoot);
  const tokenScore = computeTokenScore(context.companyName, domainRoot);
  const fuzzyScore = Math.max(domainSimilarity, tokenScore);

  if (fuzzyScore < SERPER_FUZZY_MATCH_THRESHOLD) {
    return {
      domain,
      domainRoot,
      score: fuzzyScore,
      fuzzyScore,
      tokenScore,
      keywordHits: [],
      titleMatchScore: 0,
      tldScore: 0,
      distinctiveTokenMatches: [],
      result,
      rejectionReason: "fuzzy_threshold",
    };
  }

  const distinctiveTokenMatches = getDistinctiveTokenMatches(
    context.companyName,
    contextKeywords,
    domainRoot,
    result,
  );

  if (
    getDistinctiveCompanyTokens(context.companyName, contextKeywords).length > 0
    && distinctiveTokenMatches.length < SERPER_MIN_DISTINCTIVE_TOKEN_MATCHES
  ) {
    return {
      domain,
      domainRoot,
      score: fuzzyScore,
      fuzzyScore,
      tokenScore,
      keywordHits: [],
      titleMatchScore: 0,
      tldScore: 0,
      distinctiveTokenMatches,
      result,
      rejectionReason: "distinctive_token_miss",
    };
  }

  const keywordHits = getKeywordHits(result, contextKeywords);
  const keywordScore = contextKeywords.length === 0
    ? 0
    : Math.round((keywordHits.length / contextKeywords.length) * SERPER_KEYWORD_SCORE_WEIGHT);
  const titleMatchScore = getTitleMatchScore(context.companyName, result);
  const tldScore = getTldScore(domain);
  const score = fuzzyScore + keywordScore + titleMatchScore + tldScore;

  if (score < SERPER_RESULT_SCORE_THRESHOLD) {
    return {
      domain,
      domainRoot,
      score,
      fuzzyScore,
      tokenScore,
      keywordHits,
      titleMatchScore,
      tldScore,
      distinctiveTokenMatches,
      result,
      rejectionReason: "score_threshold",
    };
  }

  return {
    domain,
    domainRoot,
    score,
    fuzzyScore,
    tokenScore,
    keywordHits,
    titleMatchScore,
    tldScore,
    distinctiveTokenMatches,
    result,
  };
}

export function rankSerperDomainCandidates(
  results: SerperWebResultLike[],
  context: Pick<SerperWebSearchContext, "companyName" | "contextKeywords">,
): SerperRankedCandidate[] {
  return results
    .map((result) => evaluateSerperDomainCandidate(result, context))
    .filter((candidate): candidate is SerperRankedCandidate => !("rejectionReason" in candidate))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.result.position - right.result.position;
    });
}
