/**
 * BL-103 (2026-04-16) — company-name normaliser tests.
 * BL-104 (2026-04-16) — polish: trailing round-bracket strip, domain-based
 * token truncation, entry-trim, MAX_ITERATIONS warn, ampersand preservation.
 *
 * Validates the iterative trailing-suffix-strip behaviour required for the
 * 1210-solutions canary EB re-stage. Every row in the PM brief table is a
 * mandatory case; the negative tests cover idempotency, unchanged inputs,
 * and the bracketed mid-name preservation rule.
 *
 * BL-104 CHANGES vs BL-103:
 *   - 'Bar (USA) Inc' now → 'Bar' (was 'Bar (USA)' pre-BL-104).
 *   - 'Foo Ltd (UK)' now → 'Foo' (was 'Foo (UK)' pre-BL-104).
 * Both due to trailing round-bracket strip lane added to the iteration
 * ladder. Mid-string parens ("Amazon (EMEA) Services") remain preserved.
 */

import { describe, it, expect, vi } from "vitest";
import { normalizeCompanyName } from "../company-normaliser";

describe("normalizeCompanyName (BL-103)", () => {
  // -------------------------------------------------------------------------
  // PM brief table — mandatory cases.
  // Each `it()` mirrors one row of the table verbatim so a future reader can
  // diff the test names against the brief.
  // -------------------------------------------------------------------------

  it("strips trailing legal + geo to root: 'Abby Cleaning Scotland Ltd' → 'Abby Cleaning'", () => {
    expect(normalizeCompanyName("Abby Cleaning Scotland Ltd")).toBe(
      "Abby Cleaning",
    );
  });

  it("strips trailing 'Limited': 'Covenco Limited' → 'Covenco'", () => {
    expect(normalizeCompanyName("Covenco Limited")).toBe("Covenco");
  });

  it("strips trailing dotted 'Inc.': 'Google Inc.' → 'Google'", () => {
    expect(normalizeCompanyName("Google Inc.")).toBe("Google");
  });

  it("strips trailing geographic suffix: 'Google UK' → 'Google'", () => {
    expect(normalizeCompanyName("Google UK")).toBe("Google");
  });

  it("iterative strip — legal then geo: 'Google Ireland Ltd' → 'Google'", () => {
    expect(normalizeCompanyName("Google Ireland Ltd")).toBe("Google");
  });

  it("strips trailing 'Corporation': 'Microsoft Corporation' → 'Microsoft'", () => {
    expect(normalizeCompanyName("Microsoft Corporation")).toBe("Microsoft");
  });

  it("iterative strip — legal then geo: 'Microsoft UK Ltd' → 'Microsoft'", () => {
    expect(normalizeCompanyName("Microsoft UK Ltd")).toBe("Microsoft");
  });

  it("preserves industry descriptor 'Group': 'Ladder Group' → 'Ladder Group'", () => {
    expect(normalizeCompanyName("Ladder Group")).toBe("Ladder Group");
  });

  it("preserves 'The ' prefix: 'The Ladder Group' → 'The Ladder Group'", () => {
    expect(normalizeCompanyName("The Ladder Group")).toBe("The Ladder Group");
  });

  it("preserves 'Holdings' descriptor mid-strip: 'Foo Holdings Ltd' → 'Foo Holdings'", () => {
    expect(normalizeCompanyName("Foo Holdings Ltd")).toBe("Foo Holdings");
  });

  it("iterative strip with multiple descriptors: 'Acme Services UK Limited' → 'Acme Services'", () => {
    expect(normalizeCompanyName("Acme Services UK Limited")).toBe(
      "Acme Services",
    );
  });

  it("does NOT strip 'Scottish' (not in geo list — brand-identity guard): 'Scottish Widows' → 'Scottish Widows'", () => {
    expect(normalizeCompanyName("Scottish Widows")).toBe("Scottish Widows");
  });

  it("does NOT strip bare 'United' (not in geo list): 'Manchester United' → 'Manchester United'", () => {
    expect(normalizeCompanyName("Manchester United")).toBe("Manchester United");
  });

  it("preserves 'Services' descriptor at trailing end: 'Amazon Web Services' → 'Amazon Web Services'", () => {
    expect(normalizeCompanyName("Amazon Web Services")).toBe(
      "Amazon Web Services",
    );
  });

  it("does NOT strip 'Scotland' at START position: 'Scotland Insurance' → 'Scotland Insurance'", () => {
    expect(normalizeCompanyName("Scotland Insurance")).toBe(
      "Scotland Insurance",
    );
  });

  it("strips trailing 'Company': 'Northern Trust Company' → 'Northern Trust'", () => {
    expect(normalizeCompanyName("Northern Trust Company")).toBe(
      "Northern Trust",
    );
  });

  it("strips trailing comma + suffix: 'ABC, LLC' → 'ABC'", () => {
    expect(normalizeCompanyName("ABC, LLC")).toBe("ABC");
  });

  it("empty string passes through unchanged: '' → ''", () => {
    expect(normalizeCompanyName("")).toBe("");
  });

  it("null passes through unchanged: null → null", () => {
    expect(normalizeCompanyName(null)).toBeNull();
  });

  it("undefined passes through unchanged: undefined → undefined", () => {
    expect(normalizeCompanyName(undefined)).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Negatives — idempotency + unchanged-input + bracketed-mid edge case.
  // -------------------------------------------------------------------------

  it("idempotent — running twice yields the same result as once", () => {
    const inputs = [
      "Abby Cleaning Scotland Ltd",
      "Covenco Limited",
      "Google Inc.",
      "Google UK",
      "Google Ireland Ltd",
      "Microsoft Corporation",
      "Microsoft UK Ltd",
      "Ladder Group",
      "The Ladder Group",
      "Foo Holdings Ltd",
      "Acme Services UK Limited",
      "Scottish Widows",
      "Manchester United",
      "Amazon Web Services",
      "Scotland Insurance",
      "Northern Trust Company",
      "ABC, LLC",
    ];
    for (const input of inputs) {
      const once = normalizeCompanyName(input);
      const twice = normalizeCompanyName(once);
      expect(twice).toBe(once);
    }
  });

  it("already-normalised input is unchanged: 'Acme Services' → 'Acme Services'", () => {
    expect(normalizeCompanyName("Acme Services")).toBe("Acme Services");
  });
});

// ===========================================================================
// BL-104 — trailing round-bracket strip + domain-based token truncation +
// entry/per-iteration trim + MAX_ITERATIONS warn + ampersand preservation.
// ===========================================================================

describe("normalizeCompanyName (BL-104)", () => {
  // -------------------------------------------------------------------------
  // Trailing bracket cases.
  // Iteration ladder: legal → geo → trailing `(...)` strip. Mid-string parens
  // and square brackets ALWAYS preserved.
  // -------------------------------------------------------------------------

  it("strips trailing bracket group: 'C4SS (Contact 4 Support Services)' → 'C4SS'", () => {
    expect(normalizeCompanyName("C4SS (Contact 4 Support Services)")).toBe(
      "C4SS",
    );
  });

  it("iterative strip — bracket then legal: 'Foo Ltd (UK)' → 'Foo'", () => {
    // Was 'Foo (UK)' pre-BL-104. Now: strip Ltd via iteration 1 inside
    // (UK)-detach path? No — bracket strip is a third lane that runs AFTER
    // legal/geo fail on current string. Iteration 1 tries Ltd on "Foo Ltd
    // (UK)" — no match at tail (tail is ')'). Iteration 1 tries geo on
    // "Foo Ltd (UK)" — no match. Iteration 1 tries trailing bracket —
    // matches "(UK)", strips to "Foo Ltd". Iteration 2 strips "Ltd" →
    // "Foo". Iteration 3 stabilises.
    expect(normalizeCompanyName("Foo Ltd (UK)")).toBe("Foo");
  });

  it("iterative strip — legal then bracket: 'Bar (USA) Inc' → 'Bar'", () => {
    // Was 'Bar (USA)' pre-BL-104. Iteration 1: legal 'Inc' at tail matches
    // → "Bar (USA)". Iteration 2: no legal/geo match; bracket strip →
    // "Bar". Iteration 3 stabilises.
    expect(normalizeCompanyName("Bar (USA) Inc")).toBe("Bar");
  });

  it("preserves MID-string bracket: 'Amazon (EMEA) Services Ltd' → 'Amazon (EMEA) Services'", () => {
    // Iteration 1: legal 'Ltd' strips → "Amazon (EMEA) Services". Iteration
    // 2: no legal/geo match; trailing-bracket strip does NOT match because
    // the paren group is not at the end (there's " Services" after it).
    // Stable.
    expect(normalizeCompanyName("Amazon (EMEA) Services Ltd")).toBe(
      "Amazon (EMEA) Services",
    );
  });

  it("preserves SQUARE brackets (never stripped): 'Acme [UK] Ltd' → 'Acme [UK]'", () => {
    // Iteration 1: legal 'Ltd' strips → "Acme [UK]". Iteration 2: no
    // legal/geo match; trailing-bracket strip only targets round parens —
    // square brackets are left intact. Stable.
    expect(normalizeCompanyName("Acme [UK] Ltd")).toBe("Acme [UK]");
  });

  // -------------------------------------------------------------------------
  // Domain-based truncation (PM spec — exact cases).
  // Runs AFTER the iteration ladder settles. Prefix-matches cleaned tokens
  // against the domain stem tokens (case-insensitive, preserves casing on
  // survivors). Requires cleaned.length > stem.length to truncate.
  // -------------------------------------------------------------------------

  it("domain truncation — ('Sonnic Support Solutions', 'sonnic.com') → 'Sonnic'", () => {
    expect(
      normalizeCompanyName("Sonnic Support Solutions", "sonnic.com"),
    ).toBe("Sonnic");
  });

  it("domain truncation — ('Abby Cleaning Scotland Ltd', 'abby-cleaning.com') → 'Abby Cleaning'", () => {
    // Iteration ladder: 'Ltd' strips → 'Abby Cleaning Scotland' → 'Scotland'
    // strips → 'Abby Cleaning'. Domain stem = 'abby cleaning' (2 tokens).
    // Cleaned = ['Abby', 'Cleaning'] (2 tokens). Equal length → no truncation.
    expect(
      normalizeCompanyName("Abby Cleaning Scotland Ltd", "abby-cleaning.com"),
    ).toBe("Abby Cleaning");
  });

  it("domain truncation — ('Cleanevent Services Ltd', 'cleanevent.com') → 'Cleanevent'", () => {
    // Legal 'Ltd' strips → 'Cleanevent Services'. Domain stem = 'cleanevent'
    // (1 token). Cleaned = ['Cleanevent', 'Services'] (2 tokens). Prefix
    // matches → truncate to 1 → 'Cleanevent'.
    expect(
      normalizeCompanyName("Cleanevent Services Ltd", "cleanevent.com"),
    ).toBe("Cleanevent");
  });

  it("domain truncation — ('Amazon Web Services', 'amazon.com') → 'Amazon'", () => {
    // Iteration ladder: 'Services' is NOT a legal suffix (preserved); geo
    // no match. Stable at 'Amazon Web Services'. Domain stem = 'amazon'
    // (1 token). Prefix matches → truncate → 'Amazon'.
    expect(normalizeCompanyName("Amazon Web Services", "amazon.com")).toBe(
      "Amazon",
    );
  });

  it("domain truncation — ('Acme Corp', 'acmecorp.com') → 'Acme'", () => {
    // Legal 'Corp' strips → 'Acme'. Domain stem = 'acmecorp' (1 token,
    // concatenated). Cleaned = ['Acme'] (1 token). Cleaned.length ==
    // stem.length → no truncation path. Result: 'Acme'.
    expect(normalizeCompanyName("Acme Corp", "acmecorp.com")).toBe("Acme");
  });

  it("domain truncation — ('DMW Recruitment', 'dmwrecruitment.com') → 'DMW Recruitment' (no prefix match, stem is concatenated)", () => {
    // Domain stem = 'dmwrecruitment' (1 concatenated token). Cleaned =
    // ['DMW', 'Recruitment'] (2 tokens). Prefix check: cleaned[0].lower
    // = 'dmw' ≠ 'dmwrecruitment' → NO match. No truncation, returns
    // 'DMW Recruitment' as-is.
    expect(normalizeCompanyName("DMW Recruitment", "dmwrecruitment.com")).toBe(
      "DMW Recruitment",
    );
  });

  it("domain truncation — ('Foo Holdings', 'foo-holdings.com') → 'Foo Holdings' (equal token count, no truncation)", () => {
    // Domain stem = 'foo holdings' (2 tokens after dash-split). Cleaned =
    // ['Foo', 'Holdings'] (2 tokens). Equal length → no truncation.
    expect(normalizeCompanyName("Foo Holdings", "foo-holdings.com")).toBe(
      "Foo Holdings",
    );
  });

  it("domain truncation — ('Foo Holdings Group', 'foo.com') → 'Foo'", () => {
    // Iteration ladder: 'Group' not a legal suffix (preserved); stable at
    // 'Foo Holdings Group'. Domain stem = 'foo' (1 token). Cleaned = 3
    // tokens. Prefix match → truncate → 'Foo'.
    expect(normalizeCompanyName("Foo Holdings Group", "foo.com")).toBe("Foo");
  });

  it("domain fall-through — null domain disables truncation: ('Sonnic Support Solutions', null) → 'Sonnic Support Solutions'", () => {
    expect(normalizeCompanyName("Sonnic Support Solutions", null)).toBe(
      "Sonnic Support Solutions",
    );
  });

  it("domain fall-through — empty string disables truncation: ('Sonnic Support Solutions', '') → 'Sonnic Support Solutions'", () => {
    expect(normalizeCompanyName("Sonnic Support Solutions", "")).toBe(
      "Sonnic Support Solutions",
    );
  });

  it("domain fall-through — undefined disables truncation: ('Sonnic Support Solutions', undefined) → 'Sonnic Support Solutions'", () => {
    expect(normalizeCompanyName("Sonnic Support Solutions", undefined)).toBe(
      "Sonnic Support Solutions",
    );
  });

  it("domain with www prefix: ('Foo Ltd', 'www.foo.com') → 'Foo'", () => {
    // Legal 'Ltd' strips → 'Foo'. Domain stem parsing: strip 'www.' →
    // 'foo.com' → before-first-dot → 'foo'. Cleaned = ['Foo'] (1 token).
    // Stem = ['foo'] (1 token). Equal length — no truncation. Result 'Foo'.
    expect(normalizeCompanyName("Foo Ltd", "www.foo.com")).toBe("Foo");
  });

  // -------------------------------------------------------------------------
  // Trim cases (F1) — entry trim + per-iteration trim.
  // -------------------------------------------------------------------------

  it("trim — trailing whitespace doesn't bypass anchor: 'Acme Corp  ' → 'Acme'", () => {
    // Pre-BL-104: the `\s+SUFFIX\.?$` anchor fails on "Acme Corp  " because
    // trailing whitespace comes AFTER the suffix — so the regex wouldn't
    // match and 'Corp' wouldn't strip. BL-104 entry-trim fixes this:
    // raw.trim() → "Acme Corp" → strip Corp → "Acme".
    expect(normalizeCompanyName("Acme Corp  ")).toBe("Acme");
  });

  it("trim — leading whitespace stripped: '  Acme Corp' → 'Acme'", () => {
    expect(normalizeCompanyName("  Acme Corp")).toBe("Acme");
  });

  it("trim — tabs and newlines: '\\tAcme Corp\\n' → 'Acme'", () => {
    expect(normalizeCompanyName("\tAcme Corp\n")).toBe("Acme");
  });

  it("trim — empty string stays empty: '' → ''", () => {
    expect(normalizeCompanyName("")).toBe("");
  });

  it("trim — whitespace-only string becomes empty: '   ' → ''", () => {
    expect(normalizeCompanyName("   ")).toBe("");
  });

  // -------------------------------------------------------------------------
  // Ampersand preservation (F3).
  // "& Co" / "& Company" are atomic brand elements — NOT stripped when
  // preceded by `&`. Normal "Co" / "Company" strip still works.
  // -------------------------------------------------------------------------

  it("ampersand atomic brand — 'Bain & Company' → 'Bain & Company' (NOT stripped)", () => {
    expect(normalizeCompanyName("Bain & Company")).toBe("Bain & Company");
  });

  it("ampersand atomic brand — 'Mars & Co' → 'Mars & Co' (NOT stripped)", () => {
    expect(normalizeCompanyName("Mars & Co")).toBe("Mars & Co");
  });

  it("ampersand — normal legal strip still works: 'Acme Ltd' → 'Acme'", () => {
    expect(normalizeCompanyName("Acme Ltd")).toBe("Acme");
  });

  it("ampersand — 'Foo & Bar Co' → 'Foo & Bar' (Co strips because & isn't directly before Co)", () => {
    // 'Co' trailing position: preceded by ' Bar ' not by '& ' — so NOT an
    // atomic brand; legal strip applies. 'Foo & Bar' is the stable result.
    expect(normalizeCompanyName("Foo & Bar Co")).toBe("Foo & Bar");
  });

  it("ampersand — 'Bain & Company Ltd' → 'Bain & Company' (Ltd strips, & Company preserved)", () => {
    // Iteration 1: legal 'Ltd' strips (preceded by ' Company ' not '& ') →
    // 'Bain & Company'. Iteration 2: legal 'Company' at tail, preceded by
    // '& ' → ampersand guard fires, skip strip. Stable.
    expect(normalizeCompanyName("Bain & Company Ltd")).toBe("Bain & Company");
  });

  // -------------------------------------------------------------------------
  // Warn-on-cap (F2) — MAX_ITERATIONS warning.
  // Pathological 12-suffix chain exceeds the 10-iteration cap.
  // -------------------------------------------------------------------------

  it("warn-on-cap — pathological 12-suffix chain triggers console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 12 legal suffixes chained together — more than MAX_ITERATIONS (10)
    // so the loop hits the cap without stabilising.
    const input = "Foo Ltd Inc Corp PLC LLC LLP GmbH SA SARL BV NV AG";
    normalizeCompanyName(input);
    expect(warnSpy).toHaveBeenCalled();
    // Verify the warn message references our module tag.
    const firstCall = warnSpy.mock.calls[0]?.[0];
    expect(typeof firstCall).toBe("string");
    expect(String(firstCall)).toContain("[company-normaliser]");
    expect(String(firstCall)).toContain("MAX_ITERATIONS");
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Idempotency with domain.
  // normalize(normalize(raw, domain), domain) === normalize(raw, domain).
  // -------------------------------------------------------------------------

  it("idempotent with domain — double-apply yields same result", () => {
    const once = normalizeCompanyName("Sonnic Support Solutions", "sonnic.com");
    const twice = normalizeCompanyName(once, "sonnic.com");
    expect(twice).toBe(once);
    expect(twice).toBe("Sonnic");
  });
});
