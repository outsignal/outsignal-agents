/**
 * BL-093 (corrected 2026-04-16 post-da7fdf60) — variable transformer tests.
 *
 * Validates the canonical Outsignal `{FIRSTNAME}` → EB `{FIRST_NAME}`
 * mapping at the wire boundary, against the PM-provided vendor spec:
 * all tokens are SINGLE-curly UPPER_SNAKE_CASE.
 *
 * These assertions replace the prior double-curly snake_case table that
 * shipped in da7fdf60 (which was built against the wrong spec).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transformVariablesForEB } from "../variable-transform";

describe("transformVariablesForEB (vendor-authoritative spec)", () => {
  // Suppress the BL-099 warn output in unit tests unless we explicitly
  // assert on it. Each assertion test restores with vi.restoreAllMocks.
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Mapped tokens — primary vendor contract
  // -------------------------------------------------------------------------

  it("maps {FIRSTNAME} → {FIRST_NAME}", () => {
    expect(transformVariablesForEB("Hi {FIRSTNAME},")).toBe("Hi {FIRST_NAME},");
  });

  it("maps {LASTNAME} → {LAST_NAME}", () => {
    expect(transformVariablesForEB("{LASTNAME}.")).toBe("{LAST_NAME}.");
  });

  it("maps {COMPANYNAME} → {COMPANY}", () => {
    expect(transformVariablesForEB("about {COMPANYNAME}")).toBe(
      "about {COMPANY}",
    );
  });

  it("maps {JOBTITLE} → {TITLE}", () => {
    expect(transformVariablesForEB("the {JOBTITLE}")).toBe("the {TITLE}");
  });

  it("preserves {EMAIL} (canonical and vendor are identical — passthrough)", () => {
    expect(transformVariablesForEB("reply to {EMAIL}")).toBe(
      "reply to {EMAIL}",
    );
  });

  // -------------------------------------------------------------------------
  // Supported custom variables — pass through unchanged
  // -------------------------------------------------------------------------

  it("passes {LOCATION} through unchanged", () => {
    expect(transformVariablesForEB("based in {LOCATION}")).toBe(
      "based in {LOCATION}",
    );
  });

  it("passes {LASTEMAILMONTH} through unchanged", () => {
    expect(transformVariablesForEB("since {LASTEMAILMONTH}")).toBe(
      "since {LASTEMAILMONTH}",
    );
  });

  it("passes {OOO_GREETING} through unchanged", () => {
    expect(transformVariablesForEB("{OOO_GREETING} {FIRSTNAME}")).toBe(
      "{OOO_GREETING} {FIRST_NAME}",
    );
  });

  // -------------------------------------------------------------------------
  // Multiple tokens in one string
  // -------------------------------------------------------------------------

  it("transforms multiple tokens in a single string", () => {
    const input =
      "Hi {FIRSTNAME}, noticed {COMPANYNAME} is hiring a {JOBTITLE}.";
    const expected =
      "Hi {FIRST_NAME}, noticed {COMPANY} is hiring a {TITLE}.";
    expect(transformVariablesForEB(input)).toBe(expected);
  });

  // -------------------------------------------------------------------------
  // Sender signature tokens — pass through unchanged (vendor-confirmed set)
  // -------------------------------------------------------------------------

  it("preserves {SENDER_FIRST_NAME} verbatim (vendor-confirmed)", () => {
    expect(transformVariablesForEB("Cheers,\n{SENDER_FIRST_NAME}")).toBe(
      "Cheers,\n{SENDER_FIRST_NAME}",
    );
  });

  it("preserves {SENDER_FULL_NAME} verbatim (vendor-confirmed)", () => {
    expect(transformVariablesForEB(", {SENDER_FULL_NAME}")).toBe(
      ", {SENDER_FULL_NAME}",
    );
  });

  it("preserves {SENDER_EMAIL_SIGNATURE} verbatim (vendor-confirmed)", () => {
    expect(transformVariablesForEB("\n{SENDER_EMAIL_SIGNATURE}")).toBe(
      "\n{SENDER_EMAIL_SIGNATURE}",
    );
  });

  it("preserves defensive sender pass-through tokens (same vendor pattern)", () => {
    const input =
      "{SENDER_LAST_NAME} / {SENDER_EMAIL} / {SENDER_TITLE} / {SENDER_COMPANY}";
    expect(transformVariablesForEB(input)).toBe(input);
  });

  // -------------------------------------------------------------------------
  // Idempotency — already-correct EB tokens pass through unchanged on
  // second (and subsequent) passes
  // -------------------------------------------------------------------------

  it("preserves already-correct {FIRST_NAME} on second pass (idempotent)", () => {
    expect(transformVariablesForEB("Hi {FIRST_NAME},")).toBe(
      "Hi {FIRST_NAME},",
    );
  });

  it("running transform twice on vendor tokens yields the same result", () => {
    const input =
      "Hi {FIRSTNAME}, about {COMPANYNAME} and {JOBTITLE}, reply to {EMAIL}.\n\n— {SENDER_FULL_NAME}";
    const once = transformVariablesForEB(input);
    const twice = transformVariablesForEB(once);
    expect(twice).toBe(once);
  });

  it("idempotency with ALL 8 vendor tokens in one string", () => {
    // Covers the complete vendor-authoritative set — every token PM
    // confirmed plus the defensive sender ones.
    const input =
      "{FIRST_NAME} {LAST_NAME} {EMAIL} {TITLE} {COMPANY} {SENDER_FIRST_NAME} {SENDER_FULL_NAME} {SENDER_EMAIL_SIGNATURE}";
    const once = transformVariablesForEB(input);
    const twice = transformVariablesForEB(once);
    expect(once).toBe(input); // already vendor-correct, so unchanged
    expect(twice).toBe(once); // and still unchanged on second pass
  });

  // -------------------------------------------------------------------------
  // Unknown single-curly UPPER tokens — pass through + BL-099 warn
  // -------------------------------------------------------------------------

  it("preserves unknown single-curly UPPER tokens verbatim", () => {
    expect(transformVariablesForEB("Score: {SOME_FUTURE_TOKEN}")).toBe(
      "Score: {SOME_FUTURE_TOKEN}",
    );
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("returns empty string unchanged", () => {
    expect(transformVariablesForEB("")).toBe("");
  });

  it("returns plain text (no tokens) unchanged", () => {
    expect(transformVariablesForEB("Just a plain sentence.")).toBe(
      "Just a plain sentence.",
    );
  });

  it("does not match lowercase {firstName} (writer-side BANNED_PATTERNS handles those)", () => {
    // Defensive coverage of {firstName} would mask writer regressions —
    // we intentionally let lowercase pass through so it surfaces.
    expect(transformVariablesForEB("Hi {firstName}.")).toBe("Hi {firstName}.");
  });

  it("does NOT transform {{double-curly}} forms (guard against {{FIRSTNAME}} → {{{FIRST_NAME}}})", () => {
    // Single-curly regex must NOT match inside double-curly. Critical
    // guard against the exact bug shape that da7fdf60 shipped.
    expect(transformVariablesForEB("{{FIRSTNAME}}")).toBe("{{FIRSTNAME}}");
  });

  it("does NOT transform wrong-spec double-curly lowercase {{first_name}} (da7fdf60 bug shape)", () => {
    // The prior-commit wrong output would already be `{{first_name}}`.
    // If the transformer ever runs against such content, it must leave it
    // alone (single-curly regex won't match), surfacing the bad shape as
    // literal EB-unsubstituted text rather than silently double-transforming.
    expect(transformVariablesForEB("Hi {{first_name}},")).toBe(
      "Hi {{first_name}},",
    );
  });

  it("transforms tokens at start, middle, and end of string", () => {
    expect(
      transformVariablesForEB("{FIRSTNAME} likes {COMPANYNAME} a lot {JOBTITLE}"),
    ).toBe("{FIRST_NAME} likes {COMPANY} a lot {TITLE}");
  });

  // -------------------------------------------------------------------------
  // Real canary fixture — Campaign cmneqixpv step 1 body excerpt
  // -------------------------------------------------------------------------

  it("transforms the real canary cmneqixpv step 1 body shape", () => {
    const input =
      "Hi {FIRSTNAME},\n\nRunning payroll for cleaners is tough.\n\n{COMPANYNAME} keeps placing workers.";
    const expected =
      "Hi {FIRST_NAME},\n\nRunning payroll for cleaners is tough.\n\n{COMPANY} keeps placing workers.";
    expect(transformVariablesForEB(input)).toBe(expected);
  });

  // -------------------------------------------------------------------------
  // Mixed sender + lead tokens (typical sign-off)
  // -------------------------------------------------------------------------

  it("transforms mixed lead + sender tokens (typical sign-off)", () => {
    const input =
      "Hi {FIRSTNAME},\n\n[body]\n\nAll the best,\n{SENDER_FULL_NAME}";
    const expected =
      "Hi {FIRST_NAME},\n\n[body]\n\nAll the best,\n{SENDER_FULL_NAME}";
    expect(transformVariablesForEB(input)).toBe(expected);
  });

  // -------------------------------------------------------------------------
  // BL-099 warn — unmapped tokens warn; known tokens do NOT warn
  // -------------------------------------------------------------------------

  it("BL-099: emits console.warn for unknown single-curly UPPER token", () => {
    transformVariablesForEB("Text with {WEIRD_FUTURE} token");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0];
    expect(typeof call).toBe("string");
    expect(call as string).toContain("{WEIRD_FUTURE}");
    expect(call as string).toContain("unmapped");
  });

  it("BL-099: does NOT warn on known EB tokens (idempotent second pass case)", () => {
    transformVariablesForEB(
      "{FIRST_NAME} {LAST_NAME} {EMAIL} {TITLE} {COMPANY} {SENDER_FIRST_NAME} {SENDER_FULL_NAME} {SENDER_EMAIL_SIGNATURE}",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("BL-099: does NOT warn for supported custom variables", () => {
    transformVariablesForEB("{LOCATION} {LASTEMAILMONTH} {OOO_GREETING}");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("BL-099: does NOT warn when Outsignal canonical tokens are successfully mapped", () => {
    transformVariablesForEB(
      "Hi {FIRSTNAME}, {JOBTITLE} at {COMPANYNAME}, reply {EMAIL}. — {LASTNAME}",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
