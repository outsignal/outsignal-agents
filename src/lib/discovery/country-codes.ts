/**
 * Shared country normalisation helpers for discovery filters.
 *
 * Prospeo needs "Country #ISO2" input, while post-search filters need a
 * broader alias set so UK/GB/United Kingdom compare as the same place.
 */

type CountryEntry = {
  code: string;
  aliases: string[];
};

export const COUNTRY_ALIASES: Record<string, CountryEntry> = {
  "united kingdom": {
    code: "GB",
    aliases: ["uk", "gb", "great britain", "england", "scotland", "wales", "northern ireland"],
  },
  "united states": {
    code: "US",
    aliases: ["us", "usa", "united states of america", "america"],
  },
  australia: { code: "AU", aliases: ["au", "aus"] },
  canada: { code: "CA", aliases: ["ca", "can"] },
  germany: { code: "DE", aliases: ["de", "deu", "deutschland"] },
  france: { code: "FR", aliases: ["fr", "fra"] },
  netherlands: { code: "NL", aliases: ["nl", "nld", "holland"] },
  ireland: { code: "IE", aliases: ["ie", "irl", "republic of ireland"] },
  spain: { code: "ES", aliases: ["es", "esp"] },
  italy: { code: "IT", aliases: ["it", "ita"] },
  sweden: { code: "SE", aliases: ["se", "swe"] },
  norway: { code: "NO", aliases: ["no", "nor"] },
  denmark: { code: "DK", aliases: ["dk", "dnk"] },
  finland: { code: "FI", aliases: ["fi", "fin"] },
  belgium: { code: "BE", aliases: ["be", "bel"] },
  switzerland: { code: "CH", aliases: ["ch", "che"] },
  singapore: { code: "SG", aliases: ["sg"] },
  "new zealand": { code: "NZ", aliases: ["nz", "nzl"] },
};

function stripCountryCodeSuffix(value: string): string {
  return value.replace(/\s*#[A-Z]{2,3}$/i, "").trim();
}

function canonicalCountryKey(token: string): string | null {
  const stripped = stripCountryCodeSuffix(token).toLowerCase().trim();
  if (!stripped) return null;

  if (COUNTRY_ALIASES[stripped]) return stripped;

  for (const [canonical, entry] of Object.entries(COUNTRY_ALIASES)) {
    if (entry.aliases.includes(stripped)) return canonical;
    if (entry.code.toLowerCase() === stripped) return canonical;
  }

  return null;
}

function titleCaseCountry(key: string): string {
  return key
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Normalise a location string or expected country token to a set of lowercase
 * terms that can be matched against. Strips Prospeo's "#CC" suffix and expands
 * abbreviations via COUNTRY_ALIASES.
 */
export function expandCountryTerms(token: string): Set<string> {
  const stripped = stripCountryCodeSuffix(token).toLowerCase().trim();
  const terms = new Set<string>([stripped]);

  const canonical = canonicalCountryKey(token);
  if (canonical) {
    terms.add(canonical);
    const entry = COUNTRY_ALIASES[canonical];
    for (const alias of entry.aliases) terms.add(alias);
  }

  return terms;
}

/**
 * Convert a human country label to Prospeo's "Country Name #CC" format.
 * Unknown labels pass through unchanged so provider-side behavior is visible.
 */
export function toProspeoLocationFormat(location: string): string {
  const trimmed = location.trim();
  if (!trimmed) return trimmed;

  const canonical = canonicalCountryKey(trimmed);
  if (!canonical) {
    console.warn(
      `[discovery-format] Unknown country "${location}" cannot be converted to Prospeo #CC format; passing through unchanged.`,
    );
    return trimmed;
  }

  const entry = COUNTRY_ALIASES[canonical];
  return `${titleCaseCountry(canonical)} #${entry.code}`;
}
