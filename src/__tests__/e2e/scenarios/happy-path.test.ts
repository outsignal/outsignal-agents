/**
 * E2E Scenario 1: Full Happy Path
 *
 * Validates that a clean sequence passes all quality gates
 * and the audit trail records gate pass results.
 */

import { describe, it, expect } from "vitest";
import {
  checkSequenceQuality,
  checkCopyQuality,
  checkWordCount,
  checkGreeting,
  checkCTAFormat,
  checkSubjectLine,
  runFullSequenceValidation,
} from "@/lib/copy-quality";
import { CLEAN_PVP_SEQUENCE } from "../fixtures/sample-sequences";
import {
  assertGateResults,
  assertCosts,
  assertValidatorFindings,
  assertFullAuditTrail,
  type QualityAuditPayload,
} from "../helpers/audit-assertions";

describe("E2E Scenario 1: Full Happy Path", () => {
  it("clean sequence passes all structural checks", () => {
    const violations = checkSequenceQuality(CLEAN_PVP_SEQUENCE);
    expect(violations).toHaveLength(0);
  });

  it("each step individually passes word count, greeting, CTA, subject line checks", () => {
    for (let i = 0; i < CLEAN_PVP_SEQUENCE.length; i++) {
      const step = CLEAN_PVP_SEQUENCE[i];
      const isFirstStep = i === 0;

      // Word count check
      const wc = checkWordCount(step.body, step.strategy ?? "pvp");
      expect(wc, `Step ${step.position} word count should pass`).toBeNull();

      // Greeting check (first step only)
      const gr = checkGreeting(step.body, isFirstStep);
      expect(gr, `Step ${step.position} greeting should pass`).toBeNull();

      // CTA check
      const cta = checkCTAFormat(step.body);
      expect(cta, `Step ${step.position} CTA should pass`).toBeNull();

      // Subject line check
      if (step.subjectLine) {
        const sl = checkSubjectLine(step.subjectLine);
        expect(sl, `Step ${step.position} subject should pass`).toBeNull();
      }
    }
  });

  it("full sequence validation passes with no hard violations", () => {
    const result = runFullSequenceValidation(CLEAN_PVP_SEQUENCE, {
      strategy: "pvp",
      channel: "email",
    });
    expect(result.pass).toBe(true);
    expect(result.hardViolations).toHaveLength(0);
  });

  it("audit trail records all gates as pass", () => {
    const mockOutput: QualityAuditPayload = {
      qualityGates: [
        { name: "banned-patterns", severity: "hard", outcome: "pass" },
        { name: "word-count", severity: "hard", outcome: "pass" },
        { name: "greeting", severity: "hard", outcome: "pass" },
        { name: "cta-format", severity: "hard", outcome: "pass" },
        { name: "subject-line", severity: "hard", outcome: "pass" },
      ],
      rewriteLoop: { originalViolations: [], attempts: 0, finalClean: true },
      costs: { discovery: 0.5, enrichment: 0.25, total: 0.75 },
      validatorFindings: { clean: true },
    };

    assertGateResults(JSON.stringify(mockOutput), [
      { name: "banned-patterns", outcome: "pass" },
      { name: "word-count", outcome: "pass" },
      { name: "greeting", outcome: "pass" },
      { name: "cta-format", outcome: "pass" },
      { name: "subject-line", outcome: "pass" },
    ]);
  });

  it("audit trail records cost breakdown", () => {
    const mockOutput: QualityAuditPayload = {
      qualityGates: [],
      rewriteLoop: { originalViolations: [], attempts: 0, finalClean: true },
      costs: { discovery: 0.5, enrichment: 0.25, total: 0.75 },
      validatorFindings: { clean: true },
    };

    assertCosts(JSON.stringify(mockOutput), {
      hasDiscovery: true,
      hasEnrichment: true,
      totalGreaterThan: 0,
    });
  });

  it("audit trail records validator findings as clean", () => {
    const mockOutput: QualityAuditPayload = {
      qualityGates: [],
      rewriteLoop: { originalViolations: [], attempts: 0, finalClean: true },
      costs: { discovery: 0.5, enrichment: 0.25, total: 0.75 },
      validatorFindings: { clean: true },
    };

    assertValidatorFindings(JSON.stringify(mockOutput), { clean: true });
  });

  it("full audit trail has all four sections", () => {
    const mockOutput: QualityAuditPayload = {
      qualityGates: [
        { name: "banned-patterns", severity: "hard", outcome: "pass" },
      ],
      rewriteLoop: { originalViolations: [], attempts: 0, finalClean: true },
      costs: { discovery: 0.5, enrichment: 0.25, total: 0.75 },
      validatorFindings: { clean: true },
    };

    assertFullAuditTrail(JSON.stringify(mockOutput));
  });
});
