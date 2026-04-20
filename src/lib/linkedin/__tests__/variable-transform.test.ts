/**
 * BL-105 (2026-04-16) — LinkedIn variable transformer tests.
 *
 * Validates the canonical Outsignal `{FIRSTNAME}` → Handlebars `{{firstName}}`
 * mapping at the LinkedIn render boundary, symmetric to the EB-side
 * `transformVariablesForEB` in src/lib/emailbison/variable-transform.ts.
 *
 * Also includes an integration-ish test that runs a realistic template
 * through compileTemplate + buildTemplateContext with a lead whose company
 * carries a Ltd suffix (Groomi Limited), asserting that:
 *   (1) no `{UPPERCASE_` residue remains in rendered output,
 *   (2) the Ltd suffix is stripped at the render boundary (BL-103 +
 *       BL-105 together).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { transformVariablesForLinkedIn } from "../variable-transform";
import { buildTemplateContext, compileTemplate } from "../sequencing";

describe("transformVariablesForLinkedIn", () => {
  // Suppress the unmapped-token warn output in unit tests unless we
  // explicitly assert on it.
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Mapped tokens — every writer token covered by copy-quality.ts BANNED_PATTERNS
  // -------------------------------------------------------------------------

  it("maps {FIRSTNAME} → {{firstName}}", () => {
    expect(transformVariablesForLinkedIn("Hey {FIRSTNAME},")).toBe(
      "Hey {{firstName}},",
    );
  });

  it("maps {LASTNAME} → {{lastName}}", () => {
    expect(transformVariablesForLinkedIn("{LASTNAME}.")).toBe("{{lastName}}.");
  });

  it("maps {COMPANYNAME} → {{companyName}}", () => {
    expect(transformVariablesForLinkedIn("about {COMPANYNAME}")).toBe(
      "about {{companyName}}",
    );
  });

  it("maps {JOBTITLE} → {{jobTitle}}", () => {
    expect(transformVariablesForLinkedIn("the {JOBTITLE}")).toBe(
      "the {{jobTitle}}",
    );
  });

  it("maps {EMAIL} → {{email}} (defensive — context may or may not bind email)", () => {
    expect(transformVariablesForLinkedIn("reply to {EMAIL}")).toBe(
      "reply to {{email}}",
    );
  });

  it("maps {LASTEMAILMONTH} → {{lastEmailMonth}}", () => {
    expect(transformVariablesForLinkedIn("since {LASTEMAILMONTH}")).toBe(
      "since {{lastEmailMonth}}",
    );
  });

  // -------------------------------------------------------------------------
  // Multi-token transforms
  // -------------------------------------------------------------------------

  it("transforms multiple tokens in a single body", () => {
    const input =
      "Hey {FIRSTNAME}, saw {COMPANYNAME} just hired a {JOBTITLE}.";
    const expected =
      "Hey {{firstName}}, saw {{companyName}} just hired a {{jobTitle}}.";
    expect(transformVariablesForLinkedIn(input)).toBe(expected);
  });

  it("transforms tokens at start, middle, and end of string", () => {
    expect(
      transformVariablesForLinkedIn(
        "{FIRSTNAME} likes {COMPANYNAME} a lot {JOBTITLE}",
      ),
    ).toBe("{{firstName}} likes {{companyName}} a lot {{jobTitle}}");
  });

  // -------------------------------------------------------------------------
  // Idempotency — double-curly Handlebars forms pass through unchanged
  // -------------------------------------------------------------------------

  it("leaves already-transformed {{firstName}} untouched", () => {
    expect(transformVariablesForLinkedIn("Hey {{firstName}},")).toBe(
      "Hey {{firstName}},",
    );
  });

  it("is idempotent on realistic multi-token template", () => {
    const input =
      "Hey {FIRSTNAME}, about {COMPANYNAME} and {JOBTITLE}, reply to {EMAIL}.";
    const once = transformVariablesForLinkedIn(input);
    const twice = transformVariablesForLinkedIn(once);
    expect(twice).toBe(once);
  });

  it("is idempotent when ALL mapped tokens are present", () => {
    const input =
      "{FIRSTNAME} {LASTNAME} {COMPANYNAME} {JOBTITLE} {EMAIL} {LASTEMAILMONTH}";
    const once = transformVariablesForLinkedIn(input);
    const twice = transformVariablesForLinkedIn(once);
    expect(once).toBe(
      "{{firstName}} {{lastName}} {{companyName}} {{jobTitle}} {{email}} {{lastEmailMonth}}",
    );
    expect(twice).toBe(once);
  });

  // -------------------------------------------------------------------------
  // Unknown tokens — pass through + warn
  // -------------------------------------------------------------------------

  it("preserves unknown single-curly UPPER tokens verbatim", () => {
    expect(
      transformVariablesForLinkedIn("Score: {SOME_FUTURE_TOKEN}"),
    ).toBe("Score: {SOME_FUTURE_TOKEN}");
  });

  it("emits console.warn for unknown single-curly UPPER token", () => {
    transformVariablesForLinkedIn("Hey {WEIRD_FUTURE}");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0]?.[0];
    expect(typeof call).toBe("string");
    expect(call as string).toContain("{WEIRD_FUTURE}");
    expect(call as string).toContain("unmapped");
    expect(call as string).toContain("[linkedin-variable-transform]");
  });

  it("does NOT warn when ALL tokens successfully map", () => {
    transformVariablesForLinkedIn(
      "{FIRSTNAME} {LASTNAME} {COMPANYNAME} {JOBTITLE} {EMAIL} {LASTEMAILMONTH}",
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Edge cases — null / undefined / empty / double-curly / lowercase
  // -------------------------------------------------------------------------

  it("returns empty string unchanged", () => {
    expect(transformVariablesForLinkedIn("")).toBe("");
  });

  it("handles null input gracefully", () => {
    expect(transformVariablesForLinkedIn(null)).toBe("");
  });

  it("handles undefined input gracefully", () => {
    expect(transformVariablesForLinkedIn(undefined)).toBe("");
  });

  it("returns plain text (no tokens) unchanged", () => {
    expect(transformVariablesForLinkedIn("Just a plain sentence.")).toBe(
      "Just a plain sentence.",
    );
  });

  it("does NOT match lowercase {firstName} (writer-side BANNED_PATTERNS handles those)", () => {
    expect(transformVariablesForLinkedIn("Hey {firstName}.")).toBe(
      "Hey {firstName}.",
    );
  });

  it("does NOT match inside {{double-curly}} forms", () => {
    // Guard: {{FIRSTNAME}} must NOT become {{{firstName}}}.
    expect(transformVariablesForLinkedIn("{{FIRSTNAME}}")).toBe(
      "{{FIRSTNAME}}",
    );
  });

  // -------------------------------------------------------------------------
  // Realistic BlankTag LinkedIn body shape (from BL-105 diagnostic)
  // -------------------------------------------------------------------------

  it("transforms the real BlankTag LinkedIn step 1 body shape", () => {
    const input =
      "Hey {FIRSTNAME}, {COMPANYNAME} stood out because of your approach to design. Worth a chat?";
    const expected =
      "Hey {{firstName}}, {{companyName}} stood out because of your approach to design. Worth a chat?";
    expect(transformVariablesForLinkedIn(input)).toBe(expected);
  });
});

// ============================================================================
// Integration test — full compileTemplate + buildTemplateContext pipeline
// with a realistic lead (Ltd-suffix company to exercise BL-103 normaliser)
// ============================================================================

describe("LinkedIn render integration (transform + normalise + compile)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders writer-shaped template with Ltd-suffix lead: no residue, Ltd stripped", () => {
    // Realistic BlankTag-shaped template using canonical writer tokens.
    const template =
      "Hey {FIRSTNAME}, {COMPANYNAME} stood out because of your approach to {JOBTITLE} work. Would love your take — worth a chat?";

    // Realistic lead: Charlotte Wright at Groomi Limited (per BL-105 brief).
    // company carries a Ltd suffix that BL-103 normalizeCompanyName must strip.
    const person = {
      firstName: "Charlotte",
      lastName: "Wright",
      company: "Groomi Limited",
      jobTitle: "Head of Marketing",
      linkedinUrl: "https://linkedin.com/in/charlotte-wright",
    };

    const context = buildTemplateContext(person);
    const rendered = compileTemplate(template, context);

    // (1) No `{UPPERCASE_LETTERS}` residue anywhere (catches writer tokens
    // that failed to substitute). Regex matches any single-curly group of
    // 3+ uppercase letters/underscores/digits.
    expect(rendered).not.toMatch(/\{[A-Z_][A-Z0-9_]{2,}\}/);

    // (2) Specific writer tokens are fully substituted.
    expect(rendered).toContain("Charlotte");
    expect(rendered).toContain("Head of Marketing");

    // (3) Company rendered as "Groomi" (Ltd stripped at render boundary
    // per BL-103 normaliser applied in buildTemplateContext).
    expect(rendered).toContain("Groomi");
    expect(rendered).not.toContain("Groomi Limited");
    // Defense-in-depth: no bare "Limited" word anywhere in the output.
    expect(rendered).not.toMatch(/\bLimited\b/);
    expect(rendered).not.toMatch(/\bLtd\b/);

    // (4) Sanity: rendered output is a plausible message.
    expect(rendered).toMatch(/^Hey Charlotte,/);
    expect(rendered).toMatch(/worth a chat\?$/);
  });

  it("renders plain Handlebars {{firstName}} template correctly (idempotent — transform is a no-op)", () => {
    // If a template already uses Handlebars-native tokens, compileTemplate
    // must still render them correctly — the transform pass is a no-op.
    const template = "Hey {{firstName}}, from {{companyName}}.";
    const person = {
      firstName: "Freya",
      lastName: "Lincoln",
      company: "Careline365",
      jobTitle: "Head of Performance Marketing",
      linkedinUrl: null,
    };

    const context = buildTemplateContext(person);
    const rendered = compileTemplate(template, context);

    expect(rendered).toBe("Hey Freya, from Careline365.");
  });

  it("renders mixed-format template (both {FIRSTNAME} and {{companyName}}) correctly", () => {
    // Defensive: a template that accidentally mixes both formats should
    // still render. The transform converts {FIRSTNAME} → {{firstName}};
    // existing {{companyName}} is untouched.
    const template = "Hey {FIRSTNAME}, from {{companyName}}.";
    const person = {
      firstName: "Alex",
      lastName: "Doe",
      company: "Acme Inc",
      jobTitle: "CTO",
      linkedinUrl: null,
    };

    const context = buildTemplateContext(person);
    const rendered = compileTemplate(template, context);

    // Acme Inc should render as "Acme" (Inc stripped by BL-103 normaliser).
    expect(rendered).toBe("Hey Alex, from Acme.");
  });

  it("resolves spintax before variable rendering for legacy LinkedIn templates", () => {
    const template =
      "{Hey|Hi} {FIRSTNAME}, worth a chat about {COMPANYNAME}?";
    const person = {
      firstName: "Maya",
      lastName: "Cole",
      company: "Northstar Ltd",
      jobTitle: "Founder",
      linkedinUrl: null,
      email: "maya@northstar.example",
    };

    const context = buildTemplateContext(person);
    const rendered = compileTemplate(template, context);

    expect(rendered).toBe("Hey Maya, worth a chat about Northstar?");
    expect(rendered).not.toContain("{Hey|Hi}");
    expect(rendered).not.toMatch(/\{[A-Z_][A-Z0-9_]*\}/);
  });

  it("binds email and lastEmailMonth in the LinkedIn render context", () => {
    const template =
      "Following up on {EMAIL} from {LASTEMAILMONTH}, {FIRSTNAME}.";
    const person = {
      firstName: "Jordan",
      lastName: "Lee",
      company: "Acme",
      jobTitle: "COO",
      linkedinUrl: null,
      email: "jordan@acme.example",
    };

    const context = buildTemplateContext(person, undefined, {
      lastEmailMonth: "March",
    });
    const rendered = compileTemplate(template, context);

    expect(rendered).toBe(
      "Following up on jordan@acme.example from March, Jordan.",
    );
    expect(rendered).not.toMatch(/\{[A-Z_][A-Z0-9_]*\}/);
  });

  it("throws instead of returning the raw template when compilation fails", () => {
    const context = buildTemplateContext({
      firstName: "Jordan",
      lastName: "Lee",
      company: "Acme",
      jobTitle: "COO",
      linkedinUrl: null,
      email: "jordan@acme.example",
    });

    expect(() => compileTemplate("Hey {{#if firstName}", context)).toThrow(
      /template compilation failed/i,
    );
  });
});
