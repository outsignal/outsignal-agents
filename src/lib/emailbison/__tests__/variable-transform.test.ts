/**
 * BL-093 — variable transformer tests.
 *
 * Validates the canonical Outsignal `{FIRSTNAME}` → EB `{{first_name}}`
 * mapping at the wire boundary.
 */

import { describe, it, expect } from "vitest";
import { transformVariablesForEB } from "../variable-transform";

describe("transformVariablesForEB", () => {
  // -------------------------------------------------------------------------
  // Mapped tokens — primary contract
  // -------------------------------------------------------------------------

  it("maps {FIRSTNAME} → {{first_name}}", () => {
    expect(transformVariablesForEB("Hi {FIRSTNAME},")).toBe("Hi {{first_name}},");
  });

  it("maps {LASTNAME} → {{last_name}}", () => {
    expect(transformVariablesForEB("{LASTNAME}.")).toBe("{{last_name}}.");
  });

  it("maps {COMPANYNAME} → {{company}}", () => {
    expect(transformVariablesForEB("about {COMPANYNAME}")).toBe(
      "about {{company}}",
    );
  });

  it("maps {JOBTITLE} → {{title}}", () => {
    expect(transformVariablesForEB("the {JOBTITLE}")).toBe("the {{title}}");
  });

  it("maps {LOCATION} → {{notes}} (defensive — no EB lead.location field)", () => {
    expect(transformVariablesForEB("based in {LOCATION}")).toBe(
      "based in {{notes}}",
    );
  });

  it("maps {LASTEMAILMONTH} → {{lastemailmonth}} (custom variable)", () => {
    expect(transformVariablesForEB("since {LASTEMAILMONTH}")).toBe(
      "since {{lastemailmonth}}",
    );
  });

  // -------------------------------------------------------------------------
  // Multiple tokens in one string
  // -------------------------------------------------------------------------

  it("transforms multiple tokens in a single string", () => {
    const input =
      "Hi {FIRSTNAME}, noticed {COMPANYNAME} is hiring a {JOBTITLE}.";
    const expected =
      "Hi {{first_name}}, noticed {{company}} is hiring a {{title}}.";
    expect(transformVariablesForEB(input)).toBe(expected);
  });

  // -------------------------------------------------------------------------
  // Sender signature tokens — pass through unchanged
  // -------------------------------------------------------------------------

  it("preserves {SENDER_FIRST_NAME} verbatim (EB-native)", () => {
    expect(transformVariablesForEB("Cheers,\n{SENDER_FIRST_NAME}")).toBe(
      "Cheers,\n{SENDER_FIRST_NAME}",
    );
  });

  it("preserves {SENDER_FULL_NAME} verbatim (EB-native)", () => {
    expect(transformVariablesForEB("— {SENDER_FULL_NAME}")).toBe(
      "— {SENDER_FULL_NAME}",
    );
  });

  it("preserves all SENDER_* variants verbatim", () => {
    const input =
      "{SENDER_FIRST_NAME} / {SENDER_LAST_NAME} / {SENDER_FULL_NAME} / {SENDER_EMAIL} / {SENDER_TITLE} / {SENDER_COMPANY}";
    expect(transformVariablesForEB(input)).toBe(input);
  });

  // -------------------------------------------------------------------------
  // Idempotency — already-correct EB tokens pass through unchanged
  // -------------------------------------------------------------------------

  it("preserves already-correct {{first_name}} verbatim (idempotency)", () => {
    expect(transformVariablesForEB("Hi {{first_name}},")).toBe(
      "Hi {{first_name}},",
    );
  });

  it("preserves unknown double-curly tokens (likely custom variables)", () => {
    expect(transformVariablesForEB("Code: {{custom_promo_code}}")).toBe(
      "Code: {{custom_promo_code}}",
    );
  });

  it("running transform twice yields the same result (idempotent)", () => {
    const input =
      "Hi {FIRSTNAME}, about {COMPANYNAME}.\n\n— {SENDER_FIRST_NAME}";
    const once = transformVariablesForEB(input);
    const twice = transformVariablesForEB(once);
    expect(twice).toBe(once);
  });

  // -------------------------------------------------------------------------
  // Unknown single-curly UPPER tokens — pass through
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

  it("does not match lowercase {firstName} (writer-side BANNED_PATTERNS handles those)", () => {
    // Defensive coverage of {firstName} would mask writer regressions —
    // we intentionally let lowercase pass through so it surfaces as a
    // literal placeholder in the email and gets caught downstream.
    expect(transformVariablesForEB("Hi {firstName}.")).toBe("Hi {firstName}.");
  });

  it("does not match {{double-curly}} cases as single-curly", () => {
    // Single-curly regex must NOT match inside double-curly. This guard
    // protects against degenerate transforms like
    // `{{FIRSTNAME}}` → `{{{first_name}}}`.
    expect(transformVariablesForEB("{{FIRSTNAME}}")).toBe("{{FIRSTNAME}}");
  });

  it("transforms tokens at start, middle, and end of string", () => {
    expect(
      transformVariablesForEB("{FIRSTNAME} likes {COMPANYNAME} a lot {JOBTITLE}"),
    ).toBe("{{first_name}} likes {{company}} a lot {{title}}");
  });

  // -------------------------------------------------------------------------
  // Real canary fixture — Campaign cmneqixpv step 1 body excerpt
  // -------------------------------------------------------------------------

  it("transforms the real canary cmneqixpv step 1 body shape", () => {
    const input = "Hi {FIRSTNAME},\n\nRunning payroll for cleaners is tough.\n\n{COMPANYNAME} keeps placing workers.";
    const expected =
      "Hi {{first_name}},\n\nRunning payroll for cleaners is tough.\n\n{{company}} keeps placing workers.";
    expect(transformVariablesForEB(input)).toBe(expected);
  });

  // -------------------------------------------------------------------------
  // Mixed sender + lead tokens (typical sign-off)
  // -------------------------------------------------------------------------

  it("transforms mixed lead + sender tokens (typical sign-off)", () => {
    const input = "Hi {FIRSTNAME},\n\n[body]\n\nAll the best,\n{SENDER_FULL_NAME}";
    const expected =
      "Hi {{first_name}},\n\n[body]\n\nAll the best,\n{SENDER_FULL_NAME}";
    expect(transformVariablesForEB(input)).toBe(expected);
  });
});
