/**
 * Content preview utilities for resolving spintax and merge tokens.
 *
 * Pipeline: raw text -> resolveSpintax() -> substituteTokens() -> rendered preview
 * Always resolve spintax FIRST, then substitute tokens.
 */

const EXAMPLE_DATA: Record<string, string> = {
  FIRSTNAME: "Alex",
  LASTNAME: "Smith",
  COMPANYNAME: "Acme Corp",
  COMPANY: "Acme Corp",
  JOBTITLE: "Head of Operations",
  WEBSITE: "acmecorp.com",
  TITLE: "Head of Operations",
  LOCATION: "London, UK",
};

/**
 * Resolve spintax: {A|B|C} -> A (always picks first variant for consistent preview).
 * Single-option tokens like {FIRSTNAME} are left alone for substituteTokens.
 */
export function resolveSpintax(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (match, inner: string) => {
    const options = inner.split("|");
    if (options.length === 1) return match; // merge token, not spintax
    return options[0].trim();
  });
}

/**
 * Substitute merge tokens with example data.
 * Returns both the substituted text and a list of token names found (for highlighting in UI).
 */
export function substituteTokens(text: string): {
  result: string;
  tokensFound: string[];
} {
  const tokensFound: string[] = [];
  const result = text.replace(/\{([A-Z_]+)\}/g, (match, token: string) => {
    if (EXAMPLE_DATA[token]) {
      tokensFound.push(token);
      return EXAMPLE_DATA[token];
    }
    return match; // unknown token, leave as-is
  });
  return { result, tokensFound };
}

/**
 * Full preview pipeline: spintax first, then tokens.
 */
export function renderContentPreview(raw: string): string {
  const afterSpintax = resolveSpintax(raw);
  const { result } = substituteTokens(afterSpintax);
  return result;
}
