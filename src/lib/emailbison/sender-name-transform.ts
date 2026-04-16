/**
 * BL-100 (2026-04-16) — sender-name substitution transformer for the
 * EmailBison wire boundary.
 *
 * **Problem**: Writer prompts emit sender names (e.g. `Daniel Lazarus`) as
 * literal text in the email body's signature region. Post-BL-093 the
 * canary EB 89 landed correct `{FIRST_NAME}` lead tokens but still shipped
 * hardcoded `Daniel Lazarus` in the last line of every step. Workspaces
 * run multi-sender inbox pools (per BL-093 allocation map): any inbox
 * owned by a non-Daniel sender would render the wrong signature to the
 * recipient.
 *
 * **Fix at the vendor edge**: same principle as BL-093 lead variable
 * transform — normalize at the EB adapter boundary, do NOT modify writer
 * prompts. The writer emits canonical human-readable names; the adapter
 * swaps them for EB's vendor-documented sender built-ins
 * (`{SENDER_FIRST_NAME}`, `{SENDER_FULL_NAME}`, see
 * docs/emailbison-dedi-api-reference.md + BL-093 vendor spec correction)
 * before POST. EB then substitutes the actual sender per email when the
 * campaign runs.
 *
 * **Signature-region scoping**: we ONLY rewrite matches in the body's last
 * 5 non-empty lines. A sender name appearing mid-body (e.g. a greeting
 * `Hi Daniel,` to a recipient who happens to share the sender's first
 * name) MUST NOT be rewritten — that's a lead-side greeting, not a
 * signature. Limiting to the tail protects that case while still catching
 * the signature block reliably.
 *
 * **Line boundary**: EB-stored bodies are HTML-formatted and use `<br>`
 * (or `<br/>`) as their line separator — actual `\n` characters are rare
 * or absent. We split on BOTH `\n` and HTML `<br>` variants so the
 * signature detection works regardless of whether the writer emitted
 * plain text or HTML-style breaks. The replacement preserves the
 * original separators verbatim.
 *
 * **Idempotency**: a body that already contains `{SENDER_FIRST_NAME}` /
 * `{SENDER_FULL_NAME}` in its signature region produces a second-pass
 * no-op — neither token matches any roster name so the signature lines
 * pass through unchanged. `matched` returns false on this second pass,
 * which is correct (nothing needed transforming).
 *
 * **Roster semantics**: the roster carries all first names, last names,
 * and "First Last" combinations from the senders allocated to this
 * campaign (per BL-093 allocation map). ANY match is valid — we don't
 * know which specific sender EB will pick at send time, so rewriting to
 * the sender-specific token is correct regardless of which roster entry
 * matched. Names are matched case-insensitively after trim.
 */

/**
 * Roster of sender name fragments from inboxes allocated to a campaign.
 * Built by the caller (email-adapter.ts) from the already-resolved
 * per-campaign sender subset. Distinct values only; empty arrays are
 * legitimate (no-op transformer path).
 */
export type SenderRoster = {
  /** Distinct first names (e.g. `["Daniel", "Sarah"]`). */
  firstNames: string[];
  /** Distinct last names (e.g. `["Lazarus", "Chen"]`). */
  lastNames: string[];
  /** Distinct `"First Last"` combinations (e.g. `["Daniel Lazarus"]`). */
  fullNames: string[];
};

/** Result of a transform pass. `matched=false` if no signature replacement
 * happened — the caller can use this to emit a `console.warn` pointing
 * operators at writer drift, while still shipping the body verbatim. */
export type SenderNameTransformResult = {
  transformed: string;
  matched: boolean;
};

/**
 * Context for the no-match warn. Caller passes campaignId + optional
 * campaign name so the warn is greppable from a multi-campaign deploy
 * log. If omitted, the warn still fires but with "(no context)".
 */
export type SenderNameTransformContext = {
  campaignId?: string;
  campaignName?: string;
};

/**
 * Regex matching line separators in an EB-stored email body. Captures
 * BOTH `\n` and HTML `<br>` / `<br/>` / `<br />` in case-insensitive form.
 * Uses a capturing group so `.split()` preserves the separators — we
 * reconstruct the body by re-interleaving line content with captured
 * separators verbatim, so the transform doesn't perturb HTML structure.
 */
const LINE_SEPARATOR_RE = /(<br\s*\/?>|\n)/gi;

/**
 * How many non-empty lines at the end of the body count as "signature
 * region". Chosen at 5 because a typical signature block looks like:
 *   Best,
 *   Daniel
 *   Senior Consultant
 *   07376 643884
 *   daniel@example.com
 * ...which fits within 5 lines without catching mid-body closing
 * paragraphs. Tuned up from 3 so a longer signature (title + multiple
 * contact lines) still has the name line in-scope.
 */
const SIGNATURE_TAIL_LINE_COUNT = 5;

/** Escape regex metacharacters in a literal match string. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Transform sender-name literal text in the signature region of an email
 * body to EB sender built-ins (`{SENDER_FIRST_NAME}` / `{SENDER_FULL_NAME}`).
 *
 * Behaviour:
 *   1. Split body on line separators (`\n` and HTML `<br>` variants),
 *      preserving separators so reassembly is lossless.
 *   2. Walk the split fragments from the end. Identify the last
 *      `SIGNATURE_TAIL_LINE_COUNT` fragments that are non-empty after
 *      trim — those are the signature-region candidate lines.
 *   3. For each candidate line, perform exact-line match (trim + case-
 *      insensitive) against:
 *      a. full name (prefer full name over first name when both would
 *         match the same line — a "Daniel Lazarus" line must become
 *         `{SENDER_FULL_NAME}`, not `{SENDER_FIRST_NAME}` + `Lazarus`).
 *      b. first name.
 *      On match, replace the line's content (preserving any leading /
 *      trailing whitespace) with the vendor token. Adjacent lines
 *      (e.g. the title line "Senior Consultant" following "Daniel")
 *      are untouched.
 *   4. Reassemble the body by joining fragments + preserved separators.
 *   5. Return `{transformed, matched}`. If no signature match occurred
 *      AND the roster was non-empty, emit a `console.warn` so operators
 *      can see which campaigns need writer attention. `matched=false`
 *      with an empty roster is expected and does NOT warn.
 *
 * Idempotency: already-transformed bodies (containing `{SENDER_*}` tokens
 * in their signature region) don't match any roster name — the tokens are
 * not in `roster.firstNames`/etc. — so the transform is a no-op and
 * `matched=false`. The second-pass warn is suppressed when the body
 * already contains an EB sender token (we detect this to avoid noise).
 *
 * Edge cases:
 *   - Empty body: returns `{transformed: body, matched: false}` without
 *     warn (no signature to transform).
 *   - Empty roster: no-op without warn (caller-side allocation gap is
 *     already logged separately).
 *   - Body with only whitespace / newlines: no matches possible, no-op.
 *   - Leading/trailing whitespace on the matching line: preserved around
 *     the token (e.g. `"  Daniel  "` → `"  {SENDER_FIRST_NAME}  "`).
 */
export function transformSenderNames(
  body: string,
  roster: SenderRoster,
  context?: SenderNameTransformContext,
): SenderNameTransformResult {
  if (!body) {
    return { transformed: body, matched: false };
  }

  const rosterHasEntries =
    roster.firstNames.length > 0 ||
    roster.lastNames.length > 0 ||
    roster.fullNames.length > 0;

  if (!rosterHasEntries) {
    // Empty roster — nothing to match. Not a writer drift, the upstream
    // sender allocation is the gap (already logged by email-adapter.ts).
    // Silent no-op here.
    return { transformed: body, matched: false };
  }

  // Suppress the no-match warn if the body already appears transformed.
  // A single `{SENDER_` fragment anywhere is sufficient evidence; writer
  // prompts never emit EB sender tokens, so their presence means this is
  // a second-pass idempotent call (e.g. re-run of a stage deploy).
  const alreadyTransformed = /\{SENDER_(?:FIRST_NAME|FULL_NAME)\}/.test(body);

  // Split preserving separators. Fragments array alternates:
  //   [line0, sep0, line1, sep1, ..., lineN]
  // When the body starts or ends with a separator, the corresponding
  // fragment is the empty string — that's fine, the empty-trim filter
  // below skips it.
  const fragments = body.split(LINE_SEPARATOR_RE);

  // Identify "line" fragments (even-indexed when splitting with a
  // capture group) and track which are non-empty after trim.
  type LineRef = { fragIndex: number; content: string };
  const lineRefs: LineRef[] = [];
  for (let i = 0; i < fragments.length; i += 2) {
    lineRefs.push({ fragIndex: i, content: fragments[i] });
  }

  // Collect the last N non-empty lines — these are the signature region.
  const signatureLineRefs: LineRef[] = [];
  for (let i = lineRefs.length - 1; i >= 0; i--) {
    if (lineRefs[i].content.trim() === "") continue;
    signatureLineRefs.unshift(lineRefs[i]);
    if (signatureLineRefs.length >= SIGNATURE_TAIL_LINE_COUNT) break;
  }

  // Build the per-name regex set. Full names come first so the "Daniel
  // Lazarus" line picks up the full-name token, not a first-name-only
  // rewrite that would leave "Lazarus" dangling. Names are matched on
  // the full trimmed line content (no partial-line match) to protect
  // "Hi Daniel," mid-body greetings and "Regards, Daniel" combined
  // closers from being touched.
  //
  // We build a SINGLE regex per category for efficiency — if the roster
  // grows large (e.g. 50-sender pool), a compiled alternation is O(1)
  // per line match vs O(N) scanning.
  const fullNamesAlt = roster.fullNames.length
    ? new RegExp(
        `^(\\s*)(?:${roster.fullNames.map(escapeRegex).join("|")})(\\s*)$`,
        "i",
      )
    : null;
  const firstNamesAlt = roster.firstNames.length
    ? new RegExp(
        `^(\\s*)(?:${roster.firstNames.map(escapeRegex).join("|")})(\\s*)$`,
        "i",
      )
    : null;

  let matched = false;

  for (const ref of signatureLineRefs) {
    const content = ref.content;

    // Full-name check first (prefer over first-name match on the same
    // line — a "Daniel Lazarus" line must become {SENDER_FULL_NAME}).
    if (fullNamesAlt) {
      const m = content.match(fullNamesAlt);
      if (m) {
        // m[1] = leading whitespace, m[2] = trailing whitespace.
        fragments[ref.fragIndex] = `${m[1]}{SENDER_FULL_NAME}${m[2]}`;
        matched = true;
        continue;
      }
    }

    if (firstNamesAlt) {
      const m = content.match(firstNamesAlt);
      if (m) {
        fragments[ref.fragIndex] = `${m[1]}{SENDER_FIRST_NAME}${m[2]}`;
        matched = true;
        continue;
      }
    }
  }

  if (!matched && !alreadyTransformed) {
    // Writer drift — the signature region doesn't contain any known
    // sender name. Emit a warn with campaignId + a body preview so PM
    // can see which campaigns still need attention. The preview takes
    // the first 120 chars of the last 200 chars of the body so the
    // signature region is visible without dumping the whole body to
    // logs.
    const ctx = context?.campaignId
      ? `campaignId=${context.campaignId}${context.campaignName ? ` ('${context.campaignName}')` : ""}`
      : "(no context)";
    const tail = body.length > 200 ? body.slice(-200) : body;
    const preview = tail.length > 120 ? tail.slice(0, 120) : tail;
    console.warn(
      `[sender-name-transform] BL-100: no signature match for ${ctx} — passing through verbatim. Body tail preview: ${JSON.stringify(preview)}`,
    );
  }

  return {
    transformed: matched ? fragments.join("") : body,
    matched,
  };
}
