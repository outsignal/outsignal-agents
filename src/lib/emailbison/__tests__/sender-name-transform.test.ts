/**
 * BL-100 (2026-04-16) — sender-name transformer tests.
 *
 * Validates the signature-region-only replacement of literal sender
 * names with EB vendor built-ins `{SENDER_FIRST_NAME}` /
 * `{SENDER_FULL_NAME}`. Covers the mandatory cases listed in the BL-100
 * brief + edge cases around HTML `<br>` line separators (EB stores
 * bodies with `<br>` breaks, not `\n`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  transformSenderNames,
  type SenderRoster,
} from "../sender-name-transform";

const DANIEL_ROSTER: SenderRoster = {
  firstNames: ["Daniel"],
  lastNames: ["Lazarus"],
  fullNames: ["Daniel Lazarus"],
};

const MULTI_ROSTER: SenderRoster = {
  firstNames: ["Daniel", "Sarah"],
  lastNames: ["Lazarus", "Chen"],
  fullNames: ["Daniel Lazarus", "Sarah Chen"],
};

const EMPTY_ROSTER: SenderRoster = {
  firstNames: [],
  lastNames: [],
  fullNames: [],
};

describe("transformSenderNames (BL-100)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Primary: full-name and first-name replacement on plain-text newlines
  // -------------------------------------------------------------------------

  it("replaces full name on the last line with {SENDER_FULL_NAME}", () => {
    const body = "Hi,\n\nSome pitch.\n\nDaniel Lazarus";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe(
      "Hi,\n\nSome pitch.\n\n{SENDER_FULL_NAME}",
    );
  });

  it("replaces first name on the last line with {SENDER_FIRST_NAME}", () => {
    const body = "Hi,\n\nSome pitch.\n\nDaniel";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe("Hi,\n\nSome pitch.\n\n{SENDER_FIRST_NAME}");
  });

  // -------------------------------------------------------------------------
  // Signature-region scoping — mid-body greetings must NOT be rewritten
  // -------------------------------------------------------------------------

  it("does NOT rewrite 'Hi Daniel,' mid-body (greeting, not signature)", () => {
    // A 6-line body where 'Daniel' appears in the FIRST line (outside the
    // 5-line signature tail) and the signature is a different sender.
    // Ensures mid-body occurrences stay untouched.
    const body =
      "Hi Daniel,\nline2\nline3\nline4\nline5\nline6\n\nSarah Chen";
    const result = transformSenderNames(body, MULTI_ROSTER);
    expect(result.matched).toBe(true);
    // First-line 'Hi Daniel,' untouched (not exact-line match AND outside
    // the last-5-non-empty window given this body length).
    expect(result.transformed).toContain("Hi Daniel,");
    // Signature line replaced.
    expect(result.transformed).toContain("{SENDER_FULL_NAME}");
    // Literal 'Sarah Chen' gone.
    expect(result.transformed).not.toContain("Sarah Chen");
  });

  // -------------------------------------------------------------------------
  // Signature block with title line after the name
  // -------------------------------------------------------------------------

  it("replaces 'Daniel' line when signature has a title line after it", () => {
    // Signature block ordering:
    //   line N-1 (non-empty): "Daniel"     ← this should be rewritten
    //   line N   (non-empty): "Senior Consultant"   ← untouched
    const body =
      "Hi,\n\nPitch content.\n\nBest,\nDaniel\nSenior Consultant";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe(
      "Hi,\n\nPitch content.\n\nBest,\n{SENDER_FIRST_NAME}\nSenior Consultant",
    );
    // Title line survives verbatim.
    expect(result.transformed).toContain("Senior Consultant");
  });

  // -------------------------------------------------------------------------
  // No match + warn
  // -------------------------------------------------------------------------

  it("passes through when no signature match, emits warn with context", () => {
    const body = "Hi there,\n\nSome pitch.\n\nSincerely,\nJane";
    const result = transformSenderNames(body, DANIEL_ROSTER, {
      campaignId: "cmTest123",
      campaignName: "Test Campaign",
    });
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe(body);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnArg = warnSpy.mock.calls[0][0] as string;
    expect(warnArg).toContain("BL-100");
    expect(warnArg).toContain("cmTest123");
    expect(warnArg).toContain("Test Campaign");
  });

  // -------------------------------------------------------------------------
  // Multi-sender roster: ANY roster entry matches
  // -------------------------------------------------------------------------

  it("matches any sender in a multi-sender roster (Daniel variant)", () => {
    const body = "Pitch.\n\nDaniel Lazarus";
    const result = transformSenderNames(body, MULTI_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe("Pitch.\n\n{SENDER_FULL_NAME}");
  });

  it("matches any sender in a multi-sender roster (Sarah variant)", () => {
    const body = "Pitch.\n\nSarah Chen";
    const result = transformSenderNames(body, MULTI_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe("Pitch.\n\n{SENDER_FULL_NAME}");
  });

  // -------------------------------------------------------------------------
  // Case-insensitive match
  // -------------------------------------------------------------------------

  it("matches case-insensitively (lowercase 'daniel lazarus')", () => {
    const body = "Pitch.\n\ndaniel lazarus";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe("Pitch.\n\n{SENDER_FULL_NAME}");
  });

  it("matches case-insensitively (uppercase 'DANIEL')", () => {
    const body = "Pitch.\n\nDANIEL";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe("Pitch.\n\n{SENDER_FIRST_NAME}");
  });

  // -------------------------------------------------------------------------
  // Idempotency: second pass on already-transformed body is a no-op
  // -------------------------------------------------------------------------

  it("is idempotent — second pass is a no-op without warning", () => {
    const body = "Pitch.\n\n{SENDER_FULL_NAME}";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe(body);
    // No warn — body is recognised as already-transformed.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("full roundtrip: transform twice → same result", () => {
    const body = "Pitch.\n\nDaniel Lazarus";
    const first = transformSenderNames(body, DANIEL_ROSTER);
    const second = transformSenderNames(first.transformed, DANIEL_ROSTER);
    expect(first.transformed).toBe("Pitch.\n\n{SENDER_FULL_NAME}");
    expect(second.transformed).toBe(first.transformed);
    expect(second.matched).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Empty roster — silent no-op, no warn
  // -------------------------------------------------------------------------

  it("empty roster: no-op, no warn, no throw", () => {
    const body = "Pitch.\n\nDaniel Lazarus";
    const result = transformSenderNames(body, EMPTY_ROSTER, {
      campaignId: "cmTest123",
    });
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe(body);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // HTML `<br>` line separators — EB-stored body shape
  // -------------------------------------------------------------------------

  it("splits on HTML <br> and replaces signature name (EB-stored shape)", () => {
    // This mirrors the literal EB 89 step-1 body PM flagged — signature
    // is `Daniel Lazarus<br>07376 643884` with phone as the last line
    // and the name as the second-to-last.
    const body =
      "Hi {FIRST_NAME},<br><br>Pitch content here.<br><br>Daniel Lazarus<br>07376 643884";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe(
      "Hi {FIRST_NAME},<br><br>Pitch content here.<br><br>{SENDER_FULL_NAME}<br>07376 643884",
    );
    // Phone line untouched.
    expect(result.transformed).toContain("07376 643884");
  });

  it("splits on HTML <br /> self-closing variant", () => {
    const body = "Pitch.<br /><br />Daniel";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe("Pitch.<br /><br />{SENDER_FIRST_NAME}");
  });

  it("splits on HTML <br/> mixed-case variant", () => {
    const body = "Pitch.<BR/>Daniel";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe("Pitch.<BR/>{SENDER_FIRST_NAME}");
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("empty body: no-op, no warn", () => {
    const result = transformSenderNames("", DANIEL_ROSTER);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe("");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("preserves leading/trailing whitespace around replaced name", () => {
    const body = "Pitch.\n\n  Daniel  ";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(true);
    expect(result.transformed).toBe("Pitch.\n\n  {SENDER_FIRST_NAME}  ");
  });

  it("does not replace partial-line matches — 'Regards, Daniel' stays put", () => {
    // 'Regards, Daniel' is not an exact-line match for 'Daniel' — the
    // full-line content is 'Regards, Daniel'. Per the signature-region
    // rule we only rewrite lines whose trimmed content IS the name.
    const body = "Pitch.\n\nRegards, Daniel";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.matched).toBe(false);
    expect(result.transformed).toBe(body);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("prefers full name over first name on a combined line", () => {
    // 'Daniel Lazarus' must become {SENDER_FULL_NAME}, not
    // {SENDER_FIRST_NAME} + ' Lazarus'. Guards against ordering bug.
    const body = "Pitch.\n\nDaniel Lazarus";
    const result = transformSenderNames(body, DANIEL_ROSTER);
    expect(result.transformed).toContain("{SENDER_FULL_NAME}");
    expect(result.transformed).not.toContain("{SENDER_FIRST_NAME}");
    expect(result.transformed).not.toContain("Lazarus");
  });

  // -------------------------------------------------------------------------
  // EB 89 full step-1 body — integration-shape regression check
  // -------------------------------------------------------------------------

  it("handles the actual EB 89 step-1 body shape (full regression)", () => {
    const body =
      "Hi {FIRST_NAME},<br><br>Running payroll for {cleaners and FM operatives|security and cleaning staff} " +
      "spread across {10+ sites with different rates|multiple locations on varying pay scales} is a headache " +
      "most agencies just absorb.<br><br>We take that off your plate entirely. P45s, P60s, HMRC, statutory " +
      "payments, {worker queries, all of it|the lot, every last bit}.<br><br>{COMPANY} keeps placing workers, " +
      "we handle the admin behind them.<br><br>How many different pay rates are you processing across sites?" +
      "<br><br>Daniel Lazarus<br>07376 643884";
    const result = transformSenderNames(body, DANIEL_ROSTER, {
      campaignId: "cmneqixpv0001p8710bov1fga",
    });
    expect(result.matched).toBe(true);
    expect(result.transformed).toContain("{SENDER_FULL_NAME}<br>07376 643884");
    expect(result.transformed).not.toMatch(/Daniel Lazarus/);
    // Mid-body {FIRST_NAME} lead token untouched.
    expect(result.transformed).toContain("Hi {FIRST_NAME},");
    // Spintax + other tokens untouched.
    expect(result.transformed).toContain("{COMPANY}");
    expect(result.transformed).toContain(
      "{cleaners and FM operatives|security and cleaning staff}",
    );
  });
});
