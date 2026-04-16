/**
 * BL-103 (2026-04-16) — company-name normaliser tests.
 *
 * Validates the iterative trailing-suffix-strip behaviour required for the
 * 1210-solutions canary EB re-stage. Every row in the PM brief table is a
 * mandatory case; the negative tests at the bottom cover idempotency,
 * unchanged inputs, and the bracketed mid-name preservation rule.
 */

import { describe, it, expect } from "vitest";
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

  it("preserves bracketed mid qualifier: 'Bar (USA) Inc' → 'Bar (USA)'", () => {
    expect(normalizeCompanyName("Bar (USA) Inc")).toBe("Bar (USA)");
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
      "Bar (USA) Inc",
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

  it("preserves bracketed mid + strips trailing legal: 'Foo Ltd (UK)' → 'Foo (UK)'", () => {
    // The trailing `(UK)` is detached, then `Ltd` is stripped from the
    // remaining base "Foo Ltd", then `(UK)` is re-attached. Iteration 2
    // detaches `(UK)` again, finds no legal suffix on "Foo", suppresses geo
    // strip because a bracketed tail is present, and exits stable.
    expect(normalizeCompanyName("Foo Ltd (UK)")).toBe("Foo (UK)");
  });
});
