/**
 * Normalize a LinkedIn profile URL to the canonical /in/slug form.
 * Returns null if the URL is null/empty or does not contain an /in/ segment.
 */
export function normalizeLinkedinProfileUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/in\/([^/?#]+)/i);
  if (!match) return null;
  return `/in/${match[1].toLowerCase()}`;
}

/**
 * Build the exact LinkedIn URL variants we intentionally support in the DB.
 * This lets us do exact/insensitive matching without the dangerous
 * `contains("/in/slug")` behavior that can cross-match /in/john with
 * /in/john-doe.
 */
export function buildLinkedinProfileUrlCandidates(url: string | null): string[] {
  const normalized = normalizeLinkedinProfileUrl(url);
  if (!normalized) return [];

  const withSlash = `${normalized}/`;
  const variants = [
    normalized,
    withSlash,
    `https://linkedin.com${normalized}`,
    `https://linkedin.com${withSlash}`,
    `https://www.linkedin.com${normalized}`,
    `https://www.linkedin.com${withSlash}`,
    `http://linkedin.com${normalized}`,
    `http://linkedin.com${withSlash}`,
    `http://www.linkedin.com${normalized}`,
    `http://www.linkedin.com${withSlash}`,
  ];

  return Array.from(new Set(variants));
}
