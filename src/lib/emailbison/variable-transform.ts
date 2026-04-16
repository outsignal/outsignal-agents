/**
 * BL-093 (2026-04-16) — variable transformer for the EmailBison wire boundary.
 *
 * **VENDOR-AUTHORITATIVE SPEC (PM correction 2026-04-16, post-da7fdf60):**
 * EmailBison expects SINGLE-curly braces, UPPER_SNAKE_CASE tokens. Not
 * double-curly, not lowercase. The commit da7fdf60 shipped the wrong spec
 * (double-curly snake_case), which EB does NOT substitute — recipients would
 * have seen the literal text `{{first_name}}` in emails. This file rewrites
 * the transformer to match the vendor-documented syntax.
 *
 * Outsignal writers emit our canonical variable format:
 *   - `{FIRSTNAME}` / `{LASTNAME}` / `{COMPANYNAME}` / `{JOBTITLE}` /
 *     `{LOCATION}` / `{LASTEMAILMONTH}` (single-curly, UPPERCASE, no
 *     underscores).
 *   - copy-quality.ts BANNED_PATTERNS line 29 enforces this format —
 *     `{firstName}` (lowercase) and `{{firstName}}` (double-curly) are
 *     blocked at writer save time.
 *
 * EmailBison vendor-authoritative token set (all SINGLE-curly UPPER_SNAKE):
 *   - Lead built-ins: `{FIRST_NAME}`, `{LAST_NAME}`, `{EMAIL}`,
 *     `{TITLE}`, `{COMPANY}`.
 *   - Sender signature built-ins: `{SENDER_FIRST_NAME}`,
 *     `{SENDER_FULL_NAME}`, `{SENDER_EMAIL_SIGNATURE}`.
 *
 * Transformer maps Outsignal's canonical tokens to EB's vendor-documented
 * tokens at the wire boundary only. Writer prompts and stored copy stay in
 * Outsignal canonical format; EB-shaped tokens exist only on the wire.
 *
 * **Idempotency:** Running the transformer twice MUST be a no-op. Because
 * EB's target syntax is the SAME SHAPE as the input (single-curly
 * UPPER_SNAKE), already-transformed tokens look like "unknown" tokens to the
 * second pass and pass through unchanged. An explicit test covers this.
 *
 * **BL-099 unmapped-token warn:** When an unknown single-curly UPPER token
 * is encountered that is NOT already a known-good EB token, log a warn once
 * so writer drift surfaces at deploy time rather than as raw `{XXX}` in a
 * recipient's inbox. Tokens that are ALREADY known EB tokens (from the
 * vendor-documented set or our defensive sender pass-through set) do NOT
 * warn — those are valid second-pass-idempotent values.
 *
 * **LOCATION / LASTEMAILMONTH:** PM has NOT re-affirmed vendor mappings for
 * these tokens (2026-04-16 correction scope). Neither is in the vendor set.
 * We intentionally leave them UNMAPPED — they pass through as single-curly
 * UPPER tokens, which will trigger the BL-099 warn. This surfaces the gap
 * to PM without silently corrupting copy via a wrong mapping. Backlog BL-095
 * (proper vendor decision for LOCATION) + a new BL item for LASTEMAILMONTH
 * will resolve these properly.
 *
 * Symmetry — apply at the EB wire boundary ONLY (createSequenceSteps). Do
 * NOT mutate stored copy or writer prompts; the canonical format stays
 * Outsignal-side, the EB-shaped tokens stay EB-side.
 */

/**
 * Map of canonical Outsignal tokens to EB-vendor-documented tokens.
 *
 * Mapping rationale (vendor-authoritative per PM 2026-04-16):
 *   - FIRSTNAME    → {FIRST_NAME}
 *   - LASTNAME     → {LAST_NAME}
 *   - COMPANYNAME  → {COMPANY}
 *   - JOBTITLE     → {TITLE}
 *   - EMAIL        → {EMAIL} (explicit passthrough — canonical is also
 *     `{EMAIL}` so the mapping is a no-op, but listing it here makes the
 *     vendor coverage complete and documents intent).
 *
 * Omitted intentionally:
 *   - LOCATION: no vendor-documented EB lead.location field. Pass through
 *     unchanged + trigger BL-099 warn so writer prompts can be updated.
 *   - LASTEMAILMONTH: no vendor-documented EB built-in. Same treatment.
 */
const VAR_MAP_UPPER: Record<string, string> = {
  FIRSTNAME: "{FIRST_NAME}",
  LASTNAME: "{LAST_NAME}",
  COMPANYNAME: "{COMPANY}",
  JOBTITLE: "{TITLE}",
  EMAIL: "{EMAIL}",
};

/**
 * Known-good EB-vendor tokens (for idempotency — second-pass inputs).
 * When the transformer sees these, it passes them through verbatim AND does
 * NOT emit a BL-099 warn (they are the correct output of a prior pass).
 *
 * Includes both vendor-confirmed tokens (primary set) and defensive sender
 * pass-through tokens that follow the vendor's naming convention
 * (single-curly UPPER_SNAKE). The defensive ones (`SENDER_LAST_NAME`,
 * `SENDER_EMAIL`, `SENDER_TITLE`, `SENDER_COMPANY`) are not in the
 * vendor-confirmed list PM provided, but follow the vendor pattern so
 * passing them through unchanged is safer than blocking or warning.
 */
const KNOWN_EB_TOKENS: ReadonlySet<string> = new Set([
  // Vendor-confirmed lead built-ins
  "FIRST_NAME",
  "LAST_NAME",
  "EMAIL",
  "TITLE",
  "COMPANY",
  // Vendor-confirmed sender signature built-ins
  "SENDER_FIRST_NAME",
  "SENDER_FULL_NAME",
  "SENDER_EMAIL_SIGNATURE",
  // Defensive sender pass-through (same pattern as vendor — not
  // PM-confirmed but harmless to preserve for forward compat with future
  // EB sender fields).
  "SENDER_LAST_NAME",
  "SENDER_EMAIL",
  "SENDER_TITLE",
  "SENDER_COMPANY",
]);

/**
 * Transform Outsignal canonical tokens to EB-vendor-documented tokens.
 *
 * Matching rules:
 *   1. Single-curly token `{TOKEN}` (UPPER_SNAKE, no spaces, no nested
 *      braces). The negative lookbehind/lookahead prevent matching inside
 *      `{{...}}` — a double-curly form is NEVER rewritten (writer-side
 *      BANNED_PATTERNS catches those before they reach this function).
 *   2. For each match:
 *      - if token in VAR_MAP_UPPER → replace with mapped value.
 *      - if token in KNOWN_EB_TOKENS → preserve verbatim (EB-native /
 *        already-transformed / defensive sender).
 *      - else → preserve verbatim + console.warn (BL-099). The token is
 *        either a writer-side drift (surfaces as literal text in EB email
 *        render) or an undocumented custom variable (client responsibility
 *        to have created it in EB).
 *
 * Edge cases:
 *   - Empty input → returns empty.
 *   - Tokens with spaces inside braces (`{ FIRSTNAME }`): not matched.
 *     Writer never emits this shape; if a regression introduces it, the
 *     literal placeholder reaches EB and renders as text (quality bug, not
 *     silent corruption).
 *   - The lowercase legacy form `{firstName}` is BLOCKED at writer save
 *     time by copy-quality.ts BANNED_PATTERNS. Not handled defensively —
 *     defensive coverage would mask writer regressions.
 */
export function transformVariablesForEB(text: string): string {
  if (!text) return text;
  return text.replace(/(?<!\{)\{([A-Z_][A-Z0-9_]*)\}(?!\})/g, (full, token: string) => {
    if (token in VAR_MAP_UPPER) {
      return VAR_MAP_UPPER[token];
    }
    if (KNOWN_EB_TOKENS.has(token)) {
      // Known-good EB token (vendor-confirmed or defensive). Preserve verbatim,
      // do NOT warn — this is the idempotent second-pass case or an already-
      // correct writer token.
      return full;
    }
    // Unknown single-curly UPPER token. Pass through verbatim (better than
    // silent mis-mapping), but warn so PM can chase writer drift or missing
    // EB custom variables before recipients see literal placeholders.
    // eslint-disable-next-line no-console
    console.warn(
      `[variable-transform] unmapped token: ${full} — passing through verbatim (writer may be emitting a custom/unknown variable)`,
    );
    return full;
  });
}
