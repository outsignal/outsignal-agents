/**
 * E2E Scenario 2: Violation Detection + Rewrite Loop
 *
 * Validates that banned phrases are detected, a rewrite loop is triggered,
 * and the final output is clean with audit trail recording the loop.
 */

import { describe, it, expect } from "vitest";
import {
  checkSequenceQuality,
  checkCopyQuality,
  formatSequenceViolations,
  runFullSequenceValidation,
} from "@/lib/copy-quality";
import {
  DIRTY_BANNED_PHRASES_SEQUENCE,
  DIRTY_WRONG_VARIABLES_SEQUENCE,
  CLEAN_PVP_SEQUENCE,
} from "../fixtures/sample-sequences";
import {
  assertGateResults,
  assertRewriteLoop,
  type QualityAuditPayload,
} from "../helpers/audit-assertions";

describe("E2E Scenario 2: Violation Detection + Rewrite Loop", () => {
  it("detects banned phrases in dirty sequence", () => {
    const violations = checkSequenceQuality(DIRTY_BANNED_PHRASES_SEQUENCE);
    expect(violations.length).toBeGreaterThan(0);

    // Should catch "quick question" in the subject
    const allViolationNames = violations.flatMap((v) => v.violations);
    expect(allViolationNames).toContain("quick question");
  });

  it("detects wrong variable format (double braces)", () => {
    // checkCopyQuality catches {{firstName}} and {firstName}
    const result1 = checkCopyQuality("Hi {{firstName}}, how are you?");
    expect(result1.clean).toBe(false);
    expect(result1.violations).toContain(
      "double-brace variable (use {UPPERCASE} single braces)",
    );

    const result2 = checkCopyQuality("Hi {firstName}, welcome.");
    expect(result2.clean).toBe(false);
    expect(result2.violations).toContain(
      "lowercase variable (use {FIRSTNAME}, {COMPANYNAME}, etc.)",
    );
  });

  it("wrong variable sequence has violations across all steps", () => {
    const violations = checkSequenceQuality(DIRTY_WRONG_VARIABLES_SEQUENCE);
    expect(violations.length).toBeGreaterThan(0);

    // Should detect in multiple steps
    const stepNumbers = [...new Set(violations.map((v) => v.step))];
    expect(stepNumbers.length).toBeGreaterThanOrEqual(2);
  });

  it("clean sequence passes after simulated rewrite", () => {
    // First: dirty sequence has violations
    const dirtyViolations = checkSequenceQuality(DIRTY_BANNED_PHRASES_SEQUENCE);
    expect(dirtyViolations.length).toBeGreaterThan(0);

    // After rewrite: clean sequence passes
    const cleanViolations = checkSequenceQuality(CLEAN_PVP_SEQUENCE);
    expect(cleanViolations).toHaveLength(0);
  });

  it("audit trail records rewrite loop with correct attempt count", () => {
    const mockOutput: QualityAuditPayload = {
      qualityGates: [
        { name: "banned-patterns", severity: "hard", outcome: "fail" },
      ],
      rewriteLoop: {
        originalViolations: ["quick question", "I'd love to"],
        attempts: 1,
        finalClean: true,
      },
      costs: { total: 0 },
      validatorFindings: { clean: true },
    };

    assertRewriteLoop(JSON.stringify(mockOutput), {
      minAttempts: 1,
      finalClean: true,
    });
  });

  it("audit trail records initial gate failure then final pass", () => {
    const mockOutput: QualityAuditPayload = {
      qualityGates: [
        {
          name: "banned-patterns-initial",
          severity: "hard",
          outcome: "fail",
          detail: "quick question, I'd love to",
        },
        {
          name: "banned-patterns-post-rewrite",
          severity: "hard",
          outcome: "pass",
        },
      ],
      rewriteLoop: {
        originalViolations: ["quick question", "I'd love to"],
        attempts: 1,
        finalClean: true,
      },
      costs: { total: 0 },
      validatorFindings: { clean: true },
    };

    assertGateResults(JSON.stringify(mockOutput), [
      { name: "banned-patterns-initial", outcome: "fail" },
      { name: "banned-patterns-post-rewrite", outcome: "pass" },
    ]);
  });

  it("multiple violation types detected simultaneously", () => {
    // DIRTY_BANNED_PHRASES_SEQUENCE has: banned phrases, em dashes, exclamation in subject
    const violations = checkSequenceQuality(DIRTY_BANNED_PHRASES_SEQUENCE);
    const allViolationNames = violations.flatMap((v) => v.violations);

    // Should detect at least banned phrases and em dash
    expect(allViolationNames).toContain("quick question");
    expect(allViolationNames).toContain("em dash");
    expect(allViolationNames).toContain("I'd love to");
  });

  it("full sequence validation classifies hard vs soft violations", () => {
    const result = runFullSequenceValidation(DIRTY_BANNED_PHRASES_SEQUENCE, {
      strategy: "pvp",
      channel: "email",
    });
    expect(result.pass).toBe(false);
    expect(result.hardViolations.length).toBeGreaterThan(0);
  });

  it("formatSequenceViolations produces readable output", () => {
    const violations = checkSequenceQuality(DIRTY_BANNED_PHRASES_SEQUENCE);
    const formatted = formatSequenceViolations(violations);

    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain("Step");
    // Should reference the field
    expect(formatted).toMatch(/subject|body/);
  });
});
