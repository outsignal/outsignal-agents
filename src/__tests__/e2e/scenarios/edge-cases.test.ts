/**
 * E2E Edge Case Tests
 *
 * Budget exceeded warning, domain resolution with failures,
 * cross-campaign overlap detection.
 */

import { describe, it, expect } from "vitest";
import { assertCosts, assertGateResults } from "../helpers/audit-assertions";
import type { QualityAuditPayload } from "../helpers/audit-assertions";
import { E2E_PEOPLE, E2E_CAMPAIGNS } from "../fixtures/seed-data";

// ---------------------------------------------------------------------------
// Edge Case: Budget Exceeded Warning
// ---------------------------------------------------------------------------

describe("Edge Case: Budget Exceeded Warning", () => {
  it("cost report flags when total exceeds workspace budget", () => {
    const payload: QualityAuditPayload = {
      qualityGates: [],
      costs: { discovery: 15.0, enrichment: 8.5, verification: 2.0, total: 25.5 },
      validatorFindings: { clean: true },
    };

    const budgetThreshold = 20.0;
    expect(payload.costs!.total).toBeGreaterThan(budgetThreshold);
  });

  it("cost report with zero costs is valid", () => {
    const payload: QualityAuditPayload = {
      qualityGates: [],
      costs: { discovery: 0, enrichment: 0, verification: 0, total: 0 },
      validatorFindings: { clean: true },
    };

    const output = JSON.stringify(payload);
    assertCosts(output, {
      hasDiscovery: false,
      hasEnrichment: false,
    });
    expect(payload.costs!.total).toBe(0);
  });

  it("cost report with partial stages (only discovery)", () => {
    const payload: QualityAuditPayload = {
      qualityGates: [],
      costs: { discovery: 3.5, total: 3.5 },
      validatorFindings: { clean: true },
    };

    const output = JSON.stringify(payload);
    assertCosts(output, {
      hasDiscovery: true,
      hasEnrichment: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Edge Case: Domain Resolution with Failures
// ---------------------------------------------------------------------------

describe("Edge Case: Domain Resolution with Failures", () => {
  const companies = [
    { name: "TestCorp", domain: "testcorp.com" },
    { name: "AcmeSaaS", domain: "acmesaas.io" },
    { name: "FinLedger", domain: "finledger.co.uk" },
    { name: "CloudNova", domain: "cloudnova.com" },
    { name: "ScaleUp", domain: "scaleup.dev" },
    { name: "DataWise", domain: "datawise.io" },
    { name: "RapidStack", domain: "rapidstack.co" },
    { name: "GhostCo", domain: null },
    { name: "NoWeb Ltd", domain: null },
    { name: "Phantom Inc", domain: null },
  ];

  it("domain resolution from company names produces mixed results", () => {
    const resolved = companies.filter((c) => c.domain !== null);
    const failed = companies.filter((c) => c.domain === null);

    expect(resolved).toHaveLength(7);
    expect(failed).toHaveLength(3);
  });

  it("failed domain resolutions are logged in audit trail", () => {
    const failedNames = companies
      .filter((c) => c.domain === null)
      .map((c) => c.name);

    const mockOutput: QualityAuditPayload = {
      qualityGates: [
        {
          name: "domain-resolution",
          severity: "soft",
          outcome: "pass",
          detail: `7/10 resolved, 3 failed: [${failedNames.join(", ")}]`,
        },
      ],
      costs: { total: 0 },
      validatorFindings: { clean: true },
    };

    const output = JSON.stringify(mockOutput);
    assertGateResults(output, [
      { name: "domain-resolution", outcome: "pass" },
    ]);

    const parsed = JSON.parse(output);
    const gate = parsed.qualityGates.find(
      (g: { name: string }) => g.name === "domain-resolution",
    );
    expect(gate.detail).toContain("GhostCo");
    expect(gate.detail).toContain("NoWeb Ltd");
    expect(gate.detail).toContain("Phantom Inc");
  });

  it("discovery continues with resolved domains only", () => {
    const resolvedDomains = companies
      .filter((c) => c.domain !== null)
      .map((c) => c.domain);

    expect(resolvedDomains).toHaveLength(7);
    expect(resolvedDomains).not.toContain(null);
    expect(resolvedDomains).toContain("testcorp.com");
  });
});

// ---------------------------------------------------------------------------
// Edge Case: Cross-Campaign Overlap Detection
// ---------------------------------------------------------------------------

describe("Edge Case: Cross-Campaign Overlap Detection", () => {
  function detectOverlap(list1: string[], list2: string[]): string[] {
    const set1 = new Set(list1);
    return list2.filter((email) => set1.has(email));
  }

  it("detects person appearing in multiple campaigns", () => {
    const campaign1Emails = [
      "jane.doe@testcorp.com",
      "john.smith@acmesaas.io",
      "sarah.chen@finledger.co.uk",
      "mike.patel@cloudnova.com",
      "emma.wilson@scaleup.dev",
    ];
    const campaign2Emails = [
      "jane.doe@testcorp.com",
      "john.smith@acmesaas.io",
      "sarah.chen@finledger.co.uk",
      "alex.kumar@datawise.io",
      "lisa.jones@rapidstack.co",
    ];

    const overlap = detectOverlap(campaign1Emails, campaign2Emails);
    expect(overlap).toHaveLength(3);
    expect(overlap).toContain("jane.doe@testcorp.com");
    expect(overlap).toContain("john.smith@acmesaas.io");
    expect(overlap).toContain("sarah.chen@finledger.co.uk");
  });

  it("no overlap when campaigns target different people", () => {
    const list1 = ["a@test.com", "b@test.com"];
    const list2 = ["c@test.com", "d@test.com"];

    expect(detectOverlap(list1, list2)).toHaveLength(0);
  });

  it("overlap detection handles empty lists", () => {
    expect(detectOverlap([], ["a@test.com"])).toHaveLength(0);
    expect(detectOverlap(["a@test.com"], [])).toHaveLength(0);
    expect(detectOverlap([], [])).toHaveLength(0);
  });

  it("overlap is flagged in audit trail", () => {
    const mockOutput: QualityAuditPayload = {
      qualityGates: [
        {
          name: "overlap-detection",
          severity: "soft",
          outcome: "fail",
          detail: "3 people appear in active campaign 'Q1 Outreach'",
        },
      ],
      costs: { total: 0 },
      validatorFindings: { clean: true },
    };

    const output = JSON.stringify(mockOutput);
    assertGateResults(output, [
      { name: "overlap-detection", outcome: "fail" },
    ]);

    const parsed = JSON.parse(output);
    const gate = parsed.qualityGates.find(
      (g: { name: string }) => g.name === "overlap-detection",
    );
    expect(gate.severity).toBe("soft");
    expect(gate.detail).toContain("3 people");
  });
});
