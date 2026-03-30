/**
 * Audit trail assertion helpers for E2E tests.
 *
 * Defines the QualityAuditPayload contract that Phases 53-57
 * implementations must conform to when storing quality gate data
 * in AgentRun.output JSON.
 */

import { expect } from "vitest";

// ---------------------------------------------------------------------------
// Contract interface — the shape of quality gate data in AgentRun.output
// ---------------------------------------------------------------------------

export interface QualityAuditPayload {
  qualityGates?: Array<{
    name: string;
    severity: "hard" | "soft";
    outcome: "pass" | "fail";
    detail?: string;
  }>;
  rewriteLoop?: {
    originalViolations: string[];
    attempts: number;
    finalClean: boolean;
  };
  costs?: {
    discovery?: number;
    enrichment?: number;
    verification?: number;
    total?: number;
  };
  validatorFindings?: {
    clean: boolean;
    violations?: string[];
    coherenceIssues?: string[];
  };
}

// ---------------------------------------------------------------------------
// Assertion helpers — designed to be called inside it() blocks
// ---------------------------------------------------------------------------

/**
 * Parse AgentRun.output JSON, find qualityGates, and verify each expected gate.
 */
export function assertGateResults(
  output: string,
  expected: Array<{ name: string; outcome: "pass" | "fail" }>,
): void {
  const parsed: QualityAuditPayload = JSON.parse(output);
  expect(parsed.qualityGates).toBeDefined();
  expect(Array.isArray(parsed.qualityGates)).toBe(true);

  for (const exp of expected) {
    const gate = parsed.qualityGates!.find((g) => g.name === exp.name);
    expect(gate, `Expected gate "${exp.name}" to exist in audit trail`).toBeDefined();
    expect(gate!.outcome).toBe(exp.outcome);
  }
}

/**
 * Verify the rewriteLoop field in AgentRun.output.
 */
export function assertRewriteLoop(
  output: string,
  expected: { minAttempts: number; finalClean: boolean },
): void {
  const parsed: QualityAuditPayload = JSON.parse(output);
  expect(parsed.rewriteLoop).toBeDefined();
  expect(parsed.rewriteLoop!.attempts).toBeGreaterThanOrEqual(expected.minAttempts);
  expect(parsed.rewriteLoop!.finalClean).toBe(expected.finalClean);
}

/**
 * Verify the costs field in AgentRun.output.
 *
 * - hasDiscovery: true means costs.discovery must be > 0
 * - hasEnrichment: false means costs.enrichment must be 0 or undefined
 * - totalGreaterThan: costs.total must exceed this value
 */
export function assertCosts(
  output: string,
  expected: {
    hasDiscovery?: boolean;
    hasEnrichment?: boolean;
    totalGreaterThan?: number;
  },
): void {
  const parsed: QualityAuditPayload = JSON.parse(output);
  expect(parsed.costs).toBeDefined();

  if (expected.hasDiscovery === true) {
    expect(parsed.costs!.discovery).toBeDefined();
    expect(parsed.costs!.discovery).toBeGreaterThan(0);
  }
  if (expected.hasDiscovery === false) {
    expect(parsed.costs!.discovery ?? 0).toBe(0);
  }

  if (expected.hasEnrichment === true) {
    expect(parsed.costs!.enrichment).toBeDefined();
    expect(parsed.costs!.enrichment).toBeGreaterThan(0);
  }
  if (expected.hasEnrichment === false) {
    expect(parsed.costs!.enrichment ?? 0).toBe(0);
  }

  if (expected.totalGreaterThan !== undefined) {
    expect(parsed.costs!.total).toBeGreaterThan(expected.totalGreaterThan);
  }
}

/**
 * Verify the validatorFindings field in AgentRun.output.
 */
export function assertValidatorFindings(
  output: string,
  expected: { clean: boolean; minViolations?: number },
): void {
  const parsed: QualityAuditPayload = JSON.parse(output);
  expect(parsed.validatorFindings).toBeDefined();
  expect(parsed.validatorFindings!.clean).toBe(expected.clean);

  if (expected.minViolations !== undefined) {
    expect(parsed.validatorFindings!.violations).toBeDefined();
    expect(parsed.validatorFindings!.violations!.length).toBeGreaterThanOrEqual(
      expected.minViolations,
    );
  }
}

/**
 * Verify ALL four audit types are present (non-null) in output JSON.
 * Does not check values, just presence.
 */
export function assertFullAuditTrail(output: string): void {
  const parsed: QualityAuditPayload = JSON.parse(output);
  expect(parsed.qualityGates, "qualityGates should be present").toBeDefined();
  expect(parsed.rewriteLoop, "rewriteLoop should be present").toBeDefined();
  expect(parsed.costs, "costs should be present").toBeDefined();
  expect(parsed.validatorFindings, "validatorFindings should be present").toBeDefined();
}
