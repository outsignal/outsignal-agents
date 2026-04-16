/**
 * BL-103 (2026-04-16) — company-name normaliser for the EmailBison wire
 * boundary.
 *
 * Strips trailing legal suffixes (Ltd / Limited / LLC / Inc / Corp / PLC /
 * GmbH / Pty / ...) AND trailing geographic / regional qualifiers (UK / USA /
 * Scotland / Ireland / EMEA / ...) from a company name, iteratively, until
 * the input is stable.
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
 *   - Iterative strip-until-stable: "Acme Services UK Limited" → strip
 *     Limited → "Acme Services UK" → strip UK → "Acme Services". Cap at
 *     10 iterations to bound worst-case runtime; in practice a real
 *     company name will stabilise in 0-3.
 *   - Trailing comma + whitespace trim each iteration: "ABC, LLC" → strip
 *     LLC → "ABC," → trim trailing comma → "ABC".
 *   - Bracketed tail handling (e.g. "Foo Ltd (UK)" → "Foo (UK)"): the
 *     trailing `(...)` group is detached, the remaining base is checked
 *     for a legal-suffix strip only (geo strip is intentionally suppressed
 *     when a bracketed tail is present — we never want to strip a country
 *     name out of a parenthetical brand qualifier), then the bracketed
 *     group is re-attached. This keeps "Bar (USA) Inc" → "Bar (USA)" (Inc
 *     stripped at iteration 1; iteration 2 detaches "(USA)", finds no
 *     legal suffix, returns original).
 *   - Casing: always preserved on the surviving prefix. We never lowercase.
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
  "& Co",
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
 * Detach a trailing parenthetical group `(...)` from a string if present.
 *
 * Returns `{ base, bracket }` where `base + bracket === input.replace(/\s*$/, '')`
 * (modulo whitespace handling). If no trailing parenthetical, returns
 * `{ base: input, bracket: "" }`.
 *
 * The regex `^(.*?)(\s*\([^)]+\))\s*$` requires:
 *   - `(.*?)` lazy capture of the prefix
 *   - `(\s*\([^)]+\))` capture optional whitespace + parenthetical (no
 *     nested parens — `[^)]+` excludes the closing brace)
 *   - `\s*$` anchored to end (allowing trailing whitespace only)
 *
 * If the bracketed group is followed by ANY non-whitespace content (e.g.
 * "Bar (USA) Inc" — `Inc` follows the parenthetical), the regex doesn't
 * match and we return `{ base: input, bracket: "" }` so the suffix-strip
 * logic operates on the full string.
 */
function detachTrailingBracket(input: string): {
  base: string;
  bracket: string;
} {
  const m = input.match(/^(.*?)(\s*\([^)]+\))\s*$/);
  if (!m) return { base: input, bracket: "" };
  return { base: m[1], bracket: m[2] };
}

/**
 * Try one strip pass. Returns the modified string if any suffix matched,
 * or the original string unchanged if no match (which signals stability
 * to the outer loop).
 *
 * Order:
 *   1. Detach trailing `(...)` if present.
 *   2. Try legal suffixes (longest-first) on the base.
 *   3. If no legal match AND no bracketed tail: try geo suffixes
 *      (longest-first) on the base.
 *   4. Re-attach the bracketed tail if any.
 *
 * Why geo is suppressed when a bracket is present:
 *   "Bar (USA)" should NOT lose its "(USA)" qualifier — that's
 *   intentionally part of the brand. We only strip geo bare-words at the
 *   very tail of the string.
 */
function stripOnce(input: string): string {
  const { base, bracket } = detachTrailingBracket(input);

  // (1) Try legal suffixes.
  for (const { re } of LEGAL_PATTERNS) {
    if (re.test(base)) {
      const stripped = trimTrailingPunct(base.replace(re, ""));
      return stripped + bracket;
    }
  }

  // (2) Try geo suffixes — only when no bracketed tail present.
  if (bracket === "") {
    for (const { re } of GEO_PATTERNS) {
      if (re.test(base)) {
        return trimTrailingPunct(base.replace(re, ""));
      }
    }
  }

  // No strip — return ORIGINAL (with bracket re-attached if we detached
  // one). This signals stability to the outer loop because the returned
  // string equals (or is structurally equivalent to) the input.
  return base + bracket;
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
 * Iteratively strips trailing legal suffixes and geographic qualifiers
 * until the input is stable. Preserves casing, "The " prefix, industry
 * descriptors (Group / Holdings / Services / ...), and bracketed
 * mid-name qualifiers (Foo (UK) → Foo (UK)).
 *
 * Pass-through behaviour:
 *   - `null` → `null`
 *   - `undefined` → `undefined`
 *   - `""` → `""`
 *   - whitespace-only string → returned unchanged (no strip applied; the
 *     trim-trailing-punct after a no-op strip leaves it as-is)
 *
 * @param raw The raw company name from the lead row (typically
 *   `Person.company` or `DiscoveredPerson.company`). May be null/undefined.
 * @returns The normalised name, or the original null/undefined/empty value.
 */
export function normalizeCompanyName(raw: string): string;
export function normalizeCompanyName(raw: null): null;
export function normalizeCompanyName(raw: undefined): undefined;
export function normalizeCompanyName(
  raw: string | null | undefined,
): string | null | undefined;
export function normalizeCompanyName(
  raw: string | null | undefined,
): string | null | undefined {
  if (raw === null) return null;
  if (raw === undefined) return undefined;
  if (raw === "") return "";

  let current = raw;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = stripOnce(current);
    if (next === current) {
      // Stable — no further strip is possible.
      return current;
    }
    current = next;
  }
  // Ran out of iterations. Return whatever we have; the cap is a safety
  // net so this should never fire on real-world inputs.
  return current;
}
