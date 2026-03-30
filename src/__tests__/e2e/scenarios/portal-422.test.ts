/**
 * E2E Scenario 4: Portal 422 Hard-Block
 *
 * Validates that structural violations are detected and would trigger
 * a 422 response, with violation details in the error message.
 */

import { describe, it, expect } from "vitest";
import {
  checkSequenceQuality,
  formatSequenceViolations,
  runFullSequenceValidation,
  type SequenceStepViolation,
} from "@/lib/copy-quality";
import {
  STRUCTURAL_VIOLATION_SEQUENCE,
  CLEAN_PVP_SEQUENCE,
} from "../fixtures/sample-sequences";

describe("E2E Scenario 4: Portal 422 Hard-Block", () => {
  it("structural violations detected in bad sequence", () => {
    const violations = checkSequenceQuality(STRUCTURAL_VIOLATION_SEQUENCE);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("full validation catches hard violations in structural sequence", () => {
    const result = runFullSequenceValidation(STRUCTURAL_VIOLATION_SEQUENCE, {
      strategy: "pvp",
      channel: "email",
    });
    expect(result.pass).toBe(false);
    expect(result.hardViolations.length).toBeGreaterThan(0);

    // Should catch exclamation in subject
    const subjectViolations = result.hardViolations.filter(
      (v) => v.field === "subject",
    );
    expect(subjectViolations.length).toBeGreaterThan(0);
  });

  it("clean sequence would pass portal validation", () => {
    const violations = checkSequenceQuality(CLEAN_PVP_SEQUENCE);
    expect(violations).toHaveLength(0);

    const fullResult = runFullSequenceValidation(CLEAN_PVP_SEQUENCE, {
      strategy: "pvp",
      channel: "email",
    });
    expect(fullResult.pass).toBe(true);
  });

  it("hard violations trigger 422 response (decision logic)", () => {
    function shouldBlock(violations: SequenceStepViolation[]): boolean {
      return violations.length > 0;
    }

    expect(
      shouldBlock(checkSequenceQuality(STRUCTURAL_VIOLATION_SEQUENCE)),
    ).toBe(true);
    expect(shouldBlock(checkSequenceQuality(CLEAN_PVP_SEQUENCE))).toBe(false);
  });

  it("runFullSequenceValidation correctly classifies blocking vs non-blocking", () => {
    const badResult = runFullSequenceValidation(STRUCTURAL_VIOLATION_SEQUENCE, {
      strategy: "pvp",
      channel: "email",
    });
    const goodResult = runFullSequenceValidation(CLEAN_PVP_SEQUENCE, {
      strategy: "pvp",
      channel: "email",
    });

    // Bad sequence: pass=false (has hard violations)
    expect(badResult.pass).toBe(false);
    // Good sequence: pass=true (no hard violations)
    expect(goodResult.pass).toBe(true);
  });

  it.todo(
    "portal 422 integration test — Requires Phase 57 approve-content route to return 422 on hard violations",
  );

  it("error message includes violation details", () => {
    const violations = checkSequenceQuality(STRUCTURAL_VIOLATION_SEQUENCE);
    const formatted = formatSequenceViolations(violations);

    expect(formatted.length).toBeGreaterThan(0);
    // Should mention specific violations found in the structural sequence
    // The sequence has: em dash, "I'd love to", "just following up", etc.
    expect(formatted).toMatch(/Step/);
  });

  it("structural sequence has multiple distinct violation types", () => {
    const result = runFullSequenceValidation(STRUCTURAL_VIOLATION_SEQUENCE, {
      strategy: "pvp",
      channel: "email",
    });

    const violationTexts = result.hardViolations.map((v) => v.violation);
    // Should have violations from different categories
    expect(violationTexts.length).toBeGreaterThanOrEqual(3);

    // Verify specific expected violations are present
    const hasSubjectViolation = violationTexts.some(
      (v) => v.includes("exclamation") || v.includes("subject"),
    );
    const hasBannedPattern = violationTexts.some(
      (v) => v.includes("banned") || v.includes("em dash"),
    );
    expect(hasSubjectViolation).toBe(true);
    expect(hasBannedPattern).toBe(true);
  });
});
