/**
 * BL-105 (2026-04-16) — variable transformer for the LinkedIn Handlebars
 * render boundary.
 *
 * **Problem** (diagnostic 19:25Z): Writer prompts emit canonical Outsignal
 * single-curly UPPERCASE tokens (`{FIRSTNAME}`, `{COMPANYNAME}`, etc.) — the
 * same shape enforced by copy-quality.ts BANNED_PATTERNS line 28-29. The
 * LinkedIn runtime in `src/lib/linkedin/sequencing.ts` uses Handlebars with
 * `noEscape: true`, which ONLY substitutes `{{camelCase}}` — so writer
 * tokens are not matched and hit LinkedIn verbatim. All 4 BlankTag LinkedIn
 * campaigns affected live (BL-105 diagnostic 2026-04-16T19:25Z). Recipients
 * see literal text `Hey {FIRSTNAME}, {COMPANYNAME} stood out because...`.
 *
 * **Fix at the render edge**: same pattern as BL-093 (email variable
 * transform) and BL-103 (email company normaliser) — rewrite at the wire
 * boundary only, leave DB state and writer prompts untouched. For LinkedIn
 * the "wire" is the text handed to LinkedIn's chat UI via enqueueAction; the
 * adapter produces that text by compiling the stored Handlebars template
 * through buildTemplateContext. We run this transform immediately BEFORE
 * Handlebars.compile in compileTemplate() — at that point the text is still
 * a template, so rewriting `{FIRSTNAME}` → `{{firstName}}` makes
 * Handlebars' standard substitution do the right thing.
 *
 * **Mapping (canonical Outsignal → Handlebars context bindings in
 * buildTemplateContext):**
 *   - `{FIRSTNAME}`      → `{{firstName}}`
 *   - `{LASTNAME}`       → `{{lastName}}`
 *   - `{COMPANYNAME}`    → `{{companyName}}`
 *   - `{JOBTITLE}`       → `{{jobTitle}}`
 *   - `{EMAIL}`          → `{{email}}`
 *   - `{LASTEMAILMONTH}` → `{{lastEmailMonth}}`
 *
 * The right-hand side of each mapping is the EXACT key bound in
 * `buildTemplateContext` (see src/lib/linkedin/sequencing.ts ~lines 54-70).
 * If that function's signature changes, update this map in lockstep.
 *
 * `{{email}}` is defensive — `buildTemplateContext` does NOT currently bind
 * an `email` field (the surrounding EvaluateSequenceRulesParams takes a
 * `person.email` but doesn't pass it into the context). A template that
 * contains `{EMAIL}` today would render as empty string. We emit the
 * mapping anyway so that IF buildTemplateContext is extended to bind
 * `email`, the transform picks it up automatically. If not bound, the
 * Handlebars default (empty) preserves current behaviour — no regression.
 *
 * **Idempotency**: running the transform twice MUST be a no-op. Unlike the
 * email transformer (whose target shape matches the input shape), here the
 * target shape is DOUBLE-curly — so already-transformed `{{firstName}}`
 * tokens are structurally different from the single-curly regex and will
 * not match on the second pass. A dedicated test pins this.
 *
 * **Unknown-token warn**: an unmatched single-curly UPPER token passes
 * through verbatim AND emits a `console.warn` (symmetric to the email
 * transformer's BL-099 warn). The template string then reaches Handlebars
 * as `{UNKNOWN}` — Handlebars ignores single-curly tokens with `noEscape:
 * true`, so recipients would see the literal `{UNKNOWN}` in the rendered
 * message. Warning surfaces writer drift at deploy/send time rather than
 * silently failing.
 *
 * **Does NOT touch** `{{...}}` forms — the negative lookbehind/lookahead
 * prevents matching inside double-curly (if a template already contains
 * Handlebars-native tokens, we leave them alone).
 */

/**
 * Map of canonical Outsignal tokens (uppercase bare name, no braces) to
 * their double-curly Handlebars equivalents. Right-hand side MUST match
 * the keys bound by `buildTemplateContext` in sequencing.ts.
 */
const VAR_MAP: Record<string, string> = {
  FIRSTNAME: "{{firstName}}",
  LASTNAME: "{{lastName}}",
  COMPANYNAME: "{{companyName}}",
  JOBTITLE: "{{jobTitle}}",
  EMAIL: "{{email}}",
  LASTEMAILMONTH: "{{lastEmailMonth}}",
};

/**
 * Transform Outsignal canonical tokens (`{UPPERCASE}`) to Handlebars
 * camelCase bindings (`{{camelCase}}`) before Handlebars.compile runs.
 *
 * Matching rules:
 *   1. Single-curly `{TOKEN}` where TOKEN is UPPERCASE letters + optional
 *      underscores / digits. The negative lookbehind `(?<!\{)` and
 *      lookahead `(?!\})` prevent matching inside `{{...}}`.
 *   2. If TOKEN is in VAR_MAP → replace with the mapped `{{...}}` form.
 *   3. If TOKEN is not in VAR_MAP → preserve verbatim AND console.warn so
 *      writer drift surfaces (unknown token will render as literal text
 *      since Handlebars ignores single-curly tokens).
 *
 * Edge cases:
 *   - Null/undefined/empty-string → pass through verbatim.
 *   - `{{firstName}}` (already Handlebars-form) → unchanged (single-curly
 *     regex won't match inside double braces).
 *   - `{firstName}` lowercase → unchanged (regex requires uppercase start);
 *     the writer-side BANNED_PATTERNS block lowercase variants at save
 *     time, so defensive handling here would mask writer regressions.
 *   - Tokens with spaces inside braces (`{ FIRSTNAME }`): not matched;
 *     writer never emits this shape.
 */
export function transformVariablesForLinkedIn(
  text: string | null | undefined,
): string {
  if (text === null || text === undefined || text === "") {
    return text ?? "";
  }
  return text.replace(
    /(?<!\{)\{([A-Z][A-Z0-9_]*)\}(?!\})/g,
    (full, token: string) => {
      if (token in VAR_MAP) {
        return VAR_MAP[token];
      }
      // Unknown single-curly UPPER token. Pass through verbatim; Handlebars
      // will leave it as literal text (with noEscape), so recipients see
      // `{UNKNOWN}` — the warn makes the drift visible at send/deploy time.
      // eslint-disable-next-line no-console
      console.warn(
        `[linkedin-variable-transform] unmapped token: ${full} — passing through verbatim (writer may be emitting a custom/unknown variable; it will render as literal text in the LinkedIn message)`,
      );
      return full;
    },
  );
}
