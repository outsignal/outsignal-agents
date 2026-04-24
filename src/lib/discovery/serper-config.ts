export const SERPER_TOP_RESULT_COUNT = 10;
export const SERPER_RETRY_BUDGET = 2;
export const SERPER_FUZZY_MATCH_THRESHOLD = 40;
export const SERPER_RESULT_SCORE_THRESHOLD = 60;
export const SERPER_KEYWORD_SCORE_WEIGHT = 20;
export const SERPER_FULL_TITLE_MATCH_BONUS = 10;
export const SERPER_PARTIAL_TITLE_MATCH_BONUS = 5;
export const SERPER_MIN_DISTINCTIVE_TOKEN_MATCHES = 1;

export const SERPER_QUERY_EXCLUDED_SITES = [
  "linkedin.com",
  "facebook.com",
] as const;

export const SERPER_HARD_SKIP_DOMAINS = [
  "returnloads.net",
  "tandlonline.com",
  "tracxn.com",
  "wastebook.co.uk",
  "coachhire.directory",
  "gov.uk",
  "companieshouse.gov.uk",
  "register.fca.org.uk",
  "thegazette.co.uk",
  "linkedin.com",
  "facebook.com",
  "crunchbase.com",
  "jstor.org",
  "pmc.ncbi.nlm.nih.gov",
  "zoominfo.com",
  "apollo.io",
  "clearbit.com",
  "rocketreach.co",
  "lusha.com",
  "dnb.com",
  "signalhire.com",
] as const;

export const SERPER_NON_UK_TLDS = [
  ".com.au",
  ".ca",
  ".de",
  ".in",
  ".co.nz",
] as const;

export const SERPER_PREFERRED_UK_TLD_SCORES = {
  ".co.uk": 12,
  ".uk": 10,
  ".com": 8,
  default: 2,
} as const;

export const SERPER_NON_UK_TLD_COUNTRY_HINTS: Record<string, string[]> = {
  ".com.au": ["australia", "australian"],
  ".ca": ["canada", "canadian"],
  ".de": ["germany", "german", "deutschland"],
  ".in": ["india", "indian"],
  ".co.nz": ["new zealand", "new-zealand", "nz"],
};

export const SERPER_COMPANY_SUFFIX_TOKENS = [
  "ltd",
  "limited",
  "t/a",
  "plc",
  "co",
  "company",
] as const;
