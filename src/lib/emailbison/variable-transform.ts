/**
 * BL-093 (2026-04-16) — variable transformer for the EmailBison wire boundary.
 *
 * Outsignal writers emit our canonical variable format:
 *   - `{FIRSTNAME}` / `{LASTNAME}` / `{COMPANYNAME}` / `{JOBTITLE}` /
 *     `{LOCATION}` / `{LASTEMAILMONTH}` (single-curly, UPPERCASE)
 *   - copy-quality.ts BANNED_PATTERNS line 29 enforces this format —
 *     `{firstName}` (lowercase) and `{{firstName}}` (double-curly) are
 *     blocked at validate time.
 *
 * EmailBison expects:
 *   - Lead built-ins: `{{first_name}}`, `{{last_name}}`, `{{email}}`,
 *     `{{title}}`, `{{company}}`, `{{notes}}` — DOUBLE-curly, lowercase,
 *     snake_case.
 *   - Sender signature vars: `{SENDER_FIRST_NAME}`, `{SENDER_FULL_NAME}` —
 *     SINGLE-curly, UPPER_SNAKE. EB-native.
 *   - Custom variables (workspace-scoped): referenced by `{{var_name}}` —
 *     double-curly snake_case.
 *
 * The transformer maps our canonical tokens → EB's expected tokens. EB
 * renders the variables server-side; without this transform, recipients
 * see literal `FIRSTNAME` text in the email body.
 *
 * Idempotency: running transform twice yields the same output (already-EB
 * tokens are pass-through). Sender signature tokens (`{SENDER_…}`) and
 * unknown double-curly tokens (likely custom variables already in EB
 * format) are preserved as-is.
 *
 * Symmetry — apply at the EB wire boundary ONLY (createSequenceSteps).
 * Do NOT mutate stored copy or writer prompts; the canonical format stays
 * Outsignal-side, the EB-shaped tokens stay EB-side.
 */

/**
 * Map of canonical Outsignal tokens to EB-native tokens.
 *
 * Mapping rationale:
 *   - FIRSTNAME / LASTNAME / COMPANYNAME / JOBTITLE: direct EB lead
 *     built-ins (snake_case forms documented in
 *     docs/emailbison-dedi-api-reference.md `Lead` schema).
 *   - LOCATION: no documented EB lead.location field. Map to `{{notes}}`
 *     which is the documented free-form text field on Lead. NB: clients
 *     who actually want a location render must populate Lead.notes with a
 *     city/region string upstream. (Filed as gap — see BL-094 in report.)
 *   - LASTEMAILMONTH: not a documented EB built-in. Map to a custom
 *     variable token `{{lastemailmonth}}`. If the workspace has not
 *     created the custom variable, EB will render the placeholder
 *     literally — caller responsibility to ensure custom variables exist
 *     before deploy.
 */
const VAR_MAP_UPPER: Record<string, string> = {
  FIRSTNAME: "{{first_name}}",
  LASTNAME: "{{last_name}}",
  COMPANYNAME: "{{company}}",
  JOBTITLE: "{{title}}",
  LOCATION: "{{notes}}",
  LASTEMAILMONTH: "{{lastemailmonth}}",
};

/**
 * Sender-signature tokens that EB renders natively. We pass these through
 * unchanged — they are SINGLE-curly UPPER_SNAKE intentionally, not a typo.
 */
const SENDER_SIG_TOKENS: ReadonlySet<string> = new Set([
  "SENDER_FIRST_NAME",
  "SENDER_FULL_NAME",
  "SENDER_LAST_NAME",
  "SENDER_EMAIL",
  "SENDER_TITLE",
  "SENDER_COMPANY",
]);

/**
 * Transform Outsignal canonical tokens to EB-native tokens.
 *
 * Order:
 *   1. Match `{TOKEN}` (single-curly, no spaces inside). For each match:
 *      - if TOKEN is in VAR_MAP_UPPER → replace with mapped value.
 *      - if TOKEN is in SENDER_SIG_TOKENS → preserve verbatim (EB-native).
 *      - else preserve verbatim (defensive — could be a future EB feature
 *        or an intentionally-unknown token).
 *   2. Already-correct `{{...}}` tokens are NEVER matched by the
 *      single-curly regex — they pass through untouched.
 *
 * Edge cases:
 *   - Empty input → returns empty.
 *   - Tokens with leading/trailing spaces inside braces (`{ FIRSTNAME }`):
 *     not matched. The writer never emits this shape, so we don't normalize
 *     it. (If a future writer regression introduces it, the literal
 *     placeholder will reach EB and render as text — surfaces as a quality
 *     bug rather than silent corruption.)
 *   - The lowercase legacy form `{firstName}` is BLOCKED at writer save
 *     time by copy-quality.ts BANNED_PATTERNS (line 29), so we do not need
 *     to handle it here. Defensive coverage for `{firstName}` /
 *     `{companyName}` / etc. would mask writer regressions and is therefore
 *     intentionally NOT included.
 */
export function transformVariablesForEB(text: string): string {
  if (!text) return text;
  // Match a SINGLE-curly token: `{TOKENNAME}` — no spaces, no nested braces.
  // The negative lookbehind/lookahead avoid matching inside `{{...}}`.
  return text.replace(/(?<!\{)\{([A-Z_][A-Z0-9_]*)\}(?!\})/g, (full, token: string) => {
    if (token in VAR_MAP_UPPER) {
      return VAR_MAP_UPPER[token];
    }
    if (SENDER_SIG_TOKENS.has(token)) {
      // EB-native — preserve verbatim.
      return full;
    }
    // Unknown single-curly UPPER token — preserve verbatim. Surface as
    // a literal placeholder if EB fails to render, rather than silently
    // dropping or mis-mapping.
    return full;
  });
}
