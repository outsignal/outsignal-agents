/**
 * BL-103 (2026-04-16) — company-name normaliser for the EmailBison wire
 * boundary.
 * BL-104 (2026-04-16) — polish: trailing round-bracket strip, domain-based
 * token truncation, entry-trim, MAX_ITERATIONS warn, ampersand preservation.
 *
 * Strips trailing legal suffixes (Ltd / Limited / LLC / Inc / Corp / PLC /
 * GmbH / Pty / ...), trailing geographic / regional qualifiers (UK / USA /
 * Scotland / Ireland / EMEA / ...), AND trailing round-bracketed tails
 * ((Contact Us) / (UK) / ...) from a company name, iteratively, until the
 * input is stable. Optionally truncates the remaining name to a prefix
 * matching the domain stem when a domain hint is provided.
 *
 * Why this exists:
 *   The 1210-solutions canary EB 90 shipped lead bodies that read robotic
 *   ("Abby Cleaning Scotland Ltd keeps placing workers"). DB lead.company
 *   carries the raw legal name (correct — that's the company's identity);
 *   cold-email body copy needs the conversational form. Same vendor-edge
 *   normalisation pattern as `variable-transform.ts` (BL-093) and
 *   `sender-name-transform.ts` (BL-100): rewrite at the EB wire boundary
 *   only, leave DB + writer prompts untouched.
 *
 * Scope rules (PM brief 2026-04-16):
 *   - Legal suffixes: case-insensitive match at the trailing end of the
 *     string. Both bare (Ltd) and trailing-dot (Ltd.) variants accepted via
 *     `\.?$` in the regex; interior-dot variants (S.A., L.L.C., U.K.) are
 *     listed explicitly because `\.?$` only covers ONE optional trailing
 *     dot.
 *   - Geographic suffixes: countries, continents, major regions, and
 *     constituent UK/Australasia nations. EXPLICITLY EXCLUDES US states,
 *     UK counties, and city names — those carry brand identity (e.g.
 *     "Manchester United" must NOT lose "United"; "Scottish Widows" must
 *     NOT lose "Scottish") and the false-positive risk outweighs the
 *     normalisation benefit.
 *   - Round-bracketed tail strip (BL-104): a trailing `(...)` group at
 *     the VERY end of the string is stripped. Mid-string parentheticals
 *     (e.g. "Amazon (EMEA) Services Ltd" after the Ltd strip leaves
 *     "Amazon (EMEA) Services") are preserved — the bracketed group is
 *     only stripped when nothing non-whitespace follows it. Square
 *     brackets (e.g. "Acme [UK]") are NEVER stripped — different semantic
 *     meaning, typically used for editorial qualifiers.
 *   - Iterative strip-until-stable: "Acme Services UK Limited" → strip
 *     Limited → "Acme Services UK" → strip UK → "Acme Services". Cap at
 *     10 iterations to bound worst-case runtime; in practice a real
 *     company name will stabilise in 0-3. BL-104: when the cap is hit
 *     without stabilising, emit a console.warn so operators can chase
 *     regex edge cases before they ship bad copy silently.
 *   - Entry + per-iteration whitespace trim (BL-104): `raw.trim()` at
 *     entry and after every iteration — the `\s+SUFFIX\.?$` regex anchors
 *     on a word-boundary preceded by whitespace, so "Acme Corp  " (with
 *     trailing spaces) would ALSO match — but re-trimming after each
 *     strip ensures we don't leave trailing whitespace / comma / bracket
 *     residue on the stable return.
 *   - Ampersand preservation (BL-104): "Bain & Company" must stay
 *     "Bain & Company" — "& Co" and "& Company" are atomic brand elements
 *     when preceded by `&`. Guarded by detecting a leading `& ` before
 *     the suffix at the matched position and aborting the strip in that
 *     case. "Mars & Co" → "Mars & Co". Normal "Acme Co" / "Acme Company"
 *     still strip because the legal-suffix token does not have a `&`
 *     directly before it.
 *   - Trailing comma + whitespace trim each iteration: "ABC, LLC" → strip
 *     LLC → "ABC," → trim trailing comma → "ABC".
 *   - Bracketed mid-qualifier handling (PRE-BL-104): "Foo Ltd (UK)" →
 *     "Foo (UK)": the trailing `(...)` group is detached, the remaining
 *     base is checked for a legal-suffix strip only, then the group is
 *     re-attached. BL-104 REPLACES this: the trailing `(...)` group is
 *     now fully stripped at the end of the iteration ladder. "Foo Ltd
 *     (UK)" now → "Foo" (strip Ltd → "Foo (UK)" → strip (UK) → "Foo").
 *     "Bar (USA) Inc" → "Bar" (Inc stripped, then (USA) stripped).
 *   - Casing: always preserved on the surviving prefix. We never lowercase.
 *   - Domain-based truncation (BL-104): optional 2nd arg. When provided,
 *     AFTER the iteration ladder settles, parse the domain stem (strip
 *     `www.`, take portion before first `.`, lowercase, `-` → ` `), split
 *     into tokens, and check whether the stem tokens match a PREFIX of
 *     the cleaned-name tokens (in order, case-insensitive). If yes AND
 *     the cleaned name has MORE tokens than the match length, truncate
 *     to the match length (preserving original casing). This handles
 *     "Sonnic Support Solutions" + "sonnic.com" → "Sonnic" — the domain
 *     is authoritative evidence of the canonical brand name.
 *
 * Out of scope (NOT done here):
 *   - DB backfill of stored Person.company values. This file ONLY changes
 *     the wire payload; the DB still stores the legal name. PM may file a
 *     separate backlog item if a DB-side rename is desired.
 *   - Writer-prompt changes. The writer continues to emit `{COMPANYNAME}`
 *     placeholders; the variable transformer maps that to EB's `{COMPANY}`
 *     token; EB substitutes the lead's normalised company at send time.
 */

/**
 * Legal suffixes, longest-first.
 *
 * Each entry's regex form is `\s+ESCAPED\.?$/i` so trailing-dot variants
 * (Ltd / Ltd.) collapse to a single entry. Interior-dot variants (S.A.,
 * L.L.C., S.A.R.L.) need their own entries because the regex's `\.?` only
 * captures ONE optional trailing dot, not interior structure.
 *
 * Order matters: longest-first ensures "Pty Ltd" matches before bare "Pty"
 * (otherwise "Pty" alone would strip from "Foo Pty Ltd" leaving "Foo  Ltd"),
 * and "S.A.R.L." matches before "S.A." for similar reasons.
 *
 * Coverage anchored to the PM brief 2026-04-16 (BL-103):
 *   Limited / Ltd / Ltd. | LLC / L.L.C. | Inc / Incorporated / Inc. |
 *   Corp / Corporation / Corp. | PLC / P.L.C. | LLP / L.L.P. | GmbH |
 *   SA / S.A. | SARL / S.A.R.L. | BV / B.V. | NV / N.V. | AG / A.G. |
 *   Pty / Pty Ltd | Co / Company / Co. | SE / OY / AS / A/S /
 *   SpA / S.p.A. | KG / PBC | & Co
 */
const LEGAL_SUFFIXES: readonly string[] = [
  // Multi-word + dotted compounds (longest first by sort below)
  "Incorporated",
  "Corporation",
  "S.A.R.L.",
  "Pty Ltd",
  "Limited",
  "Company",
  "S.p.A.",
  "L.L.C.",
  "L.L.P.",
  "P.L.C.",
  "GmbH",
  "SARL",
  // BL-104: "& Co" intentionally removed from the suffix list —
  // brands like "Mars & Co" / "Bain & Company" keep the ampersand as
  // atomic brand identity. The bare "Co" / "Company" entries below
  // are guarded via `isAmpersandAtomicBrand` against the same-position
  // strip, so "Bain & Company" preserves correctly too.
  "S.A.",
  "B.V.",
  "N.V.",
  "A.G.",
  "PBC",
  "PLC",
  "LLP",
  "LLC",
  "Pty",
  "Inc",
  "Ltd",
  "Corp",
  "SpA",
  "A/S",
  "Co",
  "SE",
  "OY",
  "AS",
  "BV",
  "NV",
  "AG",
  "SA",
  "KG",
]
  .slice()
  .sort((a, b) => b.length - a.length);

/**
 * Geographic / regional suffixes, longest-first.
 *
 * EXCLUDES US states, UK counties, and cities (per PM brief — brand-identity
 * risk; cf. "Scottish Widows" / "Manchester United" / "Northern Trust").
 *
 * Same regex form as LEGAL_SUFFIXES (`\s+ESCAPED\.?$/i`); interior-dot
 * variants get their own entries.
 */
const GEO_SUFFIXES: readonly string[] = [
  // Multi-word + dotted compounds (longest first)
  "Northern Ireland",
  "United Kingdom",
  "United States",
  "South Africa",
  "New Zealand",
  "Hong Kong",
  "U.S.A.",
  "U.K.",
  "U.S.",
  "Worldwide",
  "International",
  "Singapore",
  "Australia",
  "Americas",
  "European",
  "Scotland",
  "Germany",
  "Ireland",
  "Canada",
  "England",
  "Europe",
  "France",
  "LATAM",
  "Global",
  "China",
  "EMEA",
  "APAC",
  "India",
  "Italy",
  "Japan",
  "Spain",
  "Wales",
  "Netherlands",
  "USA",
  "UAE",
  "EU",
  "US",
  "UK",
  "NZ",
]
  .slice()
  .sort((a, b) => b.length - a.length);

/**
 * Escape a literal string for safe use in a RegExp. We need this because
 * suffix entries contain `.`, `/`, and `&` which are regex metacharacters.
 */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Build a per-iteration `\s+SUFFIX\.?$/i` regex for a single suffix entry.
 *
 * The leading `\s+` enforces a word-boundary at the start of the suffix
 * (so "Manchester United" doesn't strip from a list that contained bare
 * "United" — but our list intentionally doesn't, because of false-positive
 * risk on city/club names; this is belt-and-braces).
 *
 * The trailing `\.?$` collapses bare and single-trailing-dot variants
 * (Ltd / Ltd.; Inc / Inc.; Corp / Corp.) into one entry.
 */
function suffixRegex(suffix: string): RegExp {
  return new RegExp(`\\s+${escapeRegex(suffix)}\\.?$`, "i");
}

/**
 * Pre-compute regexes for both lists at module load — saves rebuilding
 * per call. Order is preserved (longest-first).
 */
const LEGAL_PATTERNS: ReadonlyArray<{ suffix: string; re: RegExp }> =
  LEGAL_SUFFIXES.map((s) => ({ suffix: s, re: suffixRegex(s) }));
const GEO_PATTERNS: ReadonlyArray<{ suffix: string; re: RegExp }> =
  GEO_SUFFIXES.map((s) => ({ suffix: s, re: suffixRegex(s) }));

/**
 * Trim trailing whitespace AND a single trailing comma (any number of
 * comma+whitespace pairs at the end). Handles "ABC," → "ABC" and
 * "ABC ,  " → "ABC".
 */
function trimTrailingPunct(s: string): string {
  return s.replace(/[\s,]+$/, "");
}

/**
 * BL-104: Try to strip a trailing round-bracketed group `(...)` when it
 * sits at the very end of the string (optionally followed by whitespace).
 * Returns the stripped prefix, or the original input if no trailing
 * bracket is present.
 *
 * Square brackets are NEVER touched — they typically mark editorial
 * qualifiers ("Acme [UK]" / "Foo [Ltd]") and the strip is semantically
 * different. Only round parens are in scope.
 *
 * Leading / mid-string parens are preserved: "(Leading Bracket) Foo"
 * does NOT match (there's non-whitespace after the paren group).
 * "Amazon (EMEA) Services" does NOT match (the paren group is not at
 * the end).
 *
 * The regex `^(.*?\S)\s*\([^)]+\)\s*$` requires:
 *   - `(.*?\S)` lazy capture of the prefix ending in non-whitespace
 *     (ensures we don't produce an empty prefix from "(Foo)")
 *   - `\s*\([^)]+\)` the paren group with a non-empty body, no nested
 *     parens
 *   - `\s*$` anchored to end, allowing trailing whitespace only
 */
function stripTrailingRoundBracket(input: string): string {
  const m = input.match(/^(.*?\S)\s*\([^)]+\)\s*$/);
  if (!m) return input;
  return trimTrailingPunct(m[1]);
}

/**
 * BL-104: Guard against stripping '& Co' / '& Company' when the '&'
 * is part of an atomic brand element ("Bain & Company").
 *
 * Returns true if the match position is immediately preceded by an
 * ampersand (optionally with whitespace between). Those brands are
 * NOT to be stripped.
 *
 * The suffix regexes match with a leading `\s+`, so the first char of
 * the match is whitespace; we look one further back (the char before
 * that whitespace run) to check for `&`. If the prefix before the
 * match is empty OR ends in `&` (ignoring whitespace), this is the
 * atomic-brand case.
 */
function isAmpersandAtomicBrand(base: string, matchIndex: number): boolean {
  // Walk back over whitespace chars from matchIndex toward index 0.
  let i = matchIndex - 1;
  while (i >= 0 && /\s/.test(base.charAt(i))) i--;
  if (i < 0) return false; // match at start — no prefix to guard
  // The char immediately before the whitespace run (or the match if no
  // whitespace precedes) — if it's `&`, the suffix IS the second half
  // of an atomic `& Co` / `& Company` (or similar) brand element.
  return base.charAt(i) === "&";
}

/**
 * Try one strip pass. Returns the modified string if any suffix / bracket
 * matched, or the original string unchanged if no match (which signals
 * stability to the outer loop).
 *
 * BL-104 order:
 *   1. Try legal suffixes (longest-first), guarded by ampersand check.
 *   2. If no legal match: try geo suffixes (longest-first).
 *   3. If still no match: try trailing round-bracket strip.
 *
 * This is a single strip per call — the outer loop re-runs stripOnce
 * until stable, so "Foo Ltd (UK)" becomes "Foo" over 2 iterations (Ltd
 * stripped → "Foo (UK)" → (UK) stripped → "Foo").
 */
function stripOnce(input: string): string {
  const base = input;

  // (1) Try legal suffixes. Ampersand-atomic brands are guarded — we
  //     treat "& Co" / "& Company" / "& LLC" etc. as a single atomic
  //     unit and skip the strip if `&` directly precedes the match.
  for (const { re } of LEGAL_PATTERNS) {
    const m = base.match(re);
    if (m && m.index !== undefined) {
      if (isAmpersandAtomicBrand(base, m.index)) continue;
      return trimTrailingPunct(base.replace(re, ""));
    }
  }

  // (2) Try geo suffixes.
  for (const { re } of GEO_PATTERNS) {
    if (re.test(base)) {
      return trimTrailingPunct(base.replace(re, ""));
    }
  }

  // (3) Try trailing round-bracket strip. Only kicks in when no legal
  //     / geo strip was possible — keeps order-of-precedence simple.
  const bracketStripped = stripTrailingRoundBracket(base);
  if (bracketStripped !== base) return bracketStripped;

  // No strip — return unchanged. Signals stability to the outer loop.
  return base;
}

/**
 * BL-104: Domain-based token truncation.
 *
 * After the iteration ladder settles, if a domain hint was provided,
 * compare the cleaned name's tokens against the domain stem's tokens.
 * If the domain stem tokens match a PREFIX of the cleaned tokens (in
 * order, case-insensitive) AND the cleaned name has MORE tokens than
 * the match length, truncate cleaned to that prefix length (preserving
 * original casing).
 *
 * Domain stem parsing:
 *   - strip leading `www.`
 *   - take everything before the FIRST `.`
 *   - lowercase
 *   - replace `-` with ` ` (split compound brand hints)
 *
 * Examples:
 *   ('Sonnic Support Solutions', 'sonnic.com') — domain stem 'sonnic' =
 *     1 token, matches cleaned[0]='sonnic', cleaned has 3 → truncate to
 *     ['Sonnic'].
 *   ('Abby Cleaning Scotland Ltd' → (after iterate) 'Abby Cleaning',
 *     'abby-cleaning.com') — domain stem 'abby cleaning' = 2 tokens
 *     matches both, cleaned has 2 → exact match, no truncation.
 *   ('DMW Recruitment', 'dmwrecruitment.com') — domain stem 'dmwrecruitment'
 *     = 1 concatenated token, cleaned[0]='dmw' ≠ 'dmwrecruitment' → no
 *     prefix match → no truncation.
 */
function truncateByDomain(cleaned: string, domain: string): string {
  const trimmedDomain = domain.trim();
  if (trimmedDomain === "") return cleaned;

  // Parse domain stem.
  const withoutWww = trimmedDomain.replace(/^www\./i, "");
  const dotIdx = withoutWww.indexOf(".");
  const stemRaw = dotIdx === -1 ? withoutWww : withoutWww.slice(0, dotIdx);
  if (stemRaw === "") return cleaned;
  const stem = stemRaw.toLowerCase().replace(/-/g, " ").trim();
  if (stem === "") return cleaned;

  const stemTokens = stem.split(/\s+/).filter(Boolean);
  if (stemTokens.length === 0) return cleaned;

  // Tokenise cleaned preserving original casing for output.
  const cleanedTokens = cleaned.split(/\s+/).filter(Boolean);
  if (cleanedTokens.length === 0) return cleaned;

  // Only truncate when cleaned has MORE tokens than the domain match
  // length — otherwise we'd either exact-match or delete content.
  if (cleanedTokens.length <= stemTokens.length) return cleaned;

  // Check prefix match.
  for (let i = 0; i < stemTokens.length; i++) {
    if (cleanedTokens[i].toLowerCase() !== stemTokens[i]) {
      return cleaned; // No prefix match — bail.
    }
  }

  // Truncate, preserving original casing of the surviving tokens.
  return cleanedTokens.slice(0, stemTokens.length).join(" ");
}

/**
 * Hard cap on strip iterations. Bounds worst-case runtime; a real input
 * stabilises in 0-3 iterations and the cap exists purely as a safety net
 * against a future regex bug that could otherwise loop indefinitely.
 */
const MAX_ITERATIONS = 10;

/**
 * Normalise a company name for the EmailBison wire boundary.
 *
 * Iteratively strips trailing legal suffixes, geographic qualifiers, AND
 * trailing round-bracketed groups until the input is stable. Optionally
 * truncates to a domain-matched token prefix when a domain hint is
 * provided. Preserves casing, "The " prefix, industry descriptors
 * (Group / Holdings / Services / ...), and mid-name bracketed qualifiers
 * (Amazon (EMEA) Services → Amazon (EMEA) Services).
 *
 * Pass-through behaviour:
 *   - `null` → `null`
 *   - `undefined` → `undefined`
 *   - `""` → `""`
 *   - whitespace-only string → returned trimmed (empty string).
 *
 * @param raw    The raw company name from the lead row (typically
 *               `Person.company` or `DiscoveredPerson.company`). May be
 *               null/undefined.
 * @param domain Optional domain hint (typically `Person.companyDomain`).
 *               When provided AND a prefix-token match exists, truncates
 *               the cleaned name to the domain stem's token length.
 *               `null` / `undefined` / `""` disable domain truncation.
 * @returns The normalised name, or the original null/undefined/empty value.
 */
export function normalizeCompanyName(
  raw: string,
  domain?: string | null,
): string;
export function normalizeCompanyName(raw: null, domain?: string | null): null;
export function normalizeCompanyName(
  raw: undefined,
  domain?: string | null,
): undefined;
export function normalizeCompanyName(
  raw: string | null | undefined,
  domain?: string | null,
): string | null | undefined;
export function normalizeCompanyName(
  raw: string | null | undefined,
  domain?: string | null,
): string | null | undefined {
  if (raw === null) return null;
  if (raw === undefined) return undefined;

  // BL-104: trim at entry. "Acme Corp  " (trailing whitespace) would
  // bypass the `\s+SUFFIX\.?$` regex anchor without this.
  const entryTrimmed = raw.trim();
  if (entryTrimmed === "") return "";

  let current = entryTrimmed;
  let hitCap = false;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = stripOnce(current).trim();
    if (next === current) {
      // Stable — no further strip is possible.
      hitCap = false;
      break;
    }
    current = next;
    // If we just consumed the last allowed iteration and the NEXT
    // stripOnce would still change the value, we've hit the cap.
    if (i === MAX_ITERATIONS - 1 && stripOnce(current).trim() !== current) {
      hitCap = true;
    }
  }

  if (hitCap) {
    // BL-104 F2: cap hit without stabilising. Log once per call so
    // operators can chase the edge case before copy ships bad to prospects.
    // Matches the convention in variable-transform.ts / sender-name-transform.ts.
    console.warn(
      `[company-normaliser] MAX_ITERATIONS hit for input — current=${JSON.stringify(current)} raw=${JSON.stringify(raw.slice(0, 200))}`,
    );
  }

  // BL-104: domain-based truncation. Runs ONCE after the iteration
  // ladder settles; the truncated result is considered final (we do
  // not feed it back into the strip ladder — it's already stripped).
  if (domain !== undefined && domain !== null && domain !== "") {
    current = truncateByDomain(current, domain);
  }

  return current;
}
