import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// BL-037: Verify that enrichEmail verifies pre-existing emails (e.g. from
// Apify Leads Finder) through BounceBan, rather than trusting the discovery
// source's own "verified" claim.
//
// The only exception is AI Ark export-sourced emails, which are pre-verified
// by BounceBan on AI Ark's side.
// ---------------------------------------------------------------------------

// Mock prisma
const mockPrismaPersonFindUnique = vi.fn();
const mockPrismaPersonUpdate = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: (...args: unknown[]) => mockPrismaPersonFindUnique(...args),
      update: (...args: unknown[]) => mockPrismaPersonUpdate(...args),
    },
    enrichmentLog: {
      findFirst: vi.fn().mockResolvedValue(null), // shouldEnrich always returns true
    },
  },
}));

// Mock verification
const mockBouncebanVerify = vi.fn();
vi.mock("@/lib/verification/bounceban", () => ({
  verifyEmail: (...args: unknown[]) => mockBouncebanVerify(...args),
  bulkVerifyEmails: vi.fn(),
}));

const mockKittVerify = vi.fn();
vi.mock("@/lib/verification/kitt", () => ({
  verifyEmail: (...args: unknown[]) => mockKittVerify(...args),
}));

// Mock enrichment infrastructure
vi.mock("@/lib/enrichment/dedup", () => ({
  shouldEnrich: vi.fn().mockResolvedValue(false), // skip all providers — we only test the pre-existing email step
}));
vi.mock("@/lib/enrichment/log", () => ({
  recordEnrichment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/enrichment/costs", () => ({
  checkDailyCap: vi.fn().mockResolvedValue(false),
  incrementDailySpend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/enrichment/merge", () => ({
  mergePersonData: vi.fn().mockResolvedValue([]),
  mergeCompanyData: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/normalizer", () => ({
  classifyIndustry: vi.fn(),
  classifyJobTitle: vi.fn(),
  classifyCompanyName: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  notifyCreditExhaustion: vi.fn().mockResolvedValue(undefined),
}));

import { enrichEmail, createCircuitBreaker } from "../waterfall";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BL-037: pre-existing email verification in single-person path", () => {
  it("verifies Apify Leads Finder emails through BounceBan and returns early on valid", async () => {
    // Person has email from Apify Leads Finder discovery
    mockPrismaPersonFindUnique.mockResolvedValue({
      id: "p1",
      email: "jane@example.com",
      source: "discovery-apify-leads-finder",
    });

    // BounceBan says valid
    mockBouncebanVerify.mockResolvedValue({
      status: "valid",
      email: "jane@example.com",
      costUsd: 0.001,
    });

    const breaker = createCircuitBreaker();
    await enrichEmail(
      "p1",
      {
        firstName: "Jane",
        lastName: "Doe",
        companyDomain: "example.com",
        discoverySource: "apify-leads-finder",
      },
      breaker,
    );

    // BounceBan should have been called to verify the pre-existing email
    expect(mockBouncebanVerify).toHaveBeenCalledWith("jane@example.com", "p1");
    // Email should NOT have been nulled out (it passed verification)
    expect(mockPrismaPersonUpdate).not.toHaveBeenCalled();
  });

  it("nulls out Apify emails that fail BounceBan verification", async () => {
    // Person has email from Apify Leads Finder
    mockPrismaPersonFindUnique.mockResolvedValue({
      id: "p1",
      email: "bad@example.com",
      source: "discovery-apify-leads-finder",
    });

    // BounceBan says invalid
    mockBouncebanVerify.mockResolvedValue({
      status: "invalid",
      email: "bad@example.com",
      costUsd: 0.001,
    });

    const breaker = createCircuitBreaker();
    await enrichEmail(
      "p1",
      {
        firstName: "Jane",
        lastName: "Doe",
        companyDomain: "example.com",
        discoverySource: "apify-leads-finder",
      },
      breaker,
    );

    // BounceBan should have been called
    expect(mockBouncebanVerify).toHaveBeenCalledWith("bad@example.com", "p1");
    // Email should be nulled out since verification failed
    expect(mockPrismaPersonUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { email: null },
    });
  });

  it("nulls out catch-all emails instead of treating them as verified", async () => {
    mockPrismaPersonFindUnique.mockResolvedValue({
      id: "p1",
      email: "maybe@example.com",
      source: "discovery-apify-leads-finder",
    });

    mockBouncebanVerify.mockResolvedValue({
      status: "valid_catch_all",
      email: "maybe@example.com",
      costUsd: 0.001,
    });

    const breaker = createCircuitBreaker();
    await enrichEmail(
      "p1",
      {
        firstName: "Jane",
        lastName: "Doe",
        companyDomain: "example.com",
        discoverySource: "apify-leads-finder",
      },
      breaker,
    );

    expect(mockPrismaPersonUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { email: null },
    });
  });

  it("skips verification for AI Ark export-sourced emails (pre-verified by BounceBan on AI Ark side)", async () => {
    // Person has email from AI Ark export — pre-verified
    mockPrismaPersonFindUnique.mockResolvedValue({
      id: "p1",
      email: "john@acme.com",
      source: "discovery-aiark-export",
    });

    const breaker = createCircuitBreaker();
    await enrichEmail(
      "p1",
      {
        firstName: "John",
        lastName: "Smith",
        companyDomain: "acme.com",
        discoverySource: "aiark-export",
      },
      breaker,
    );

    // BounceBan should NOT have been called — AI Ark export is the one exception
    expect(mockBouncebanVerify).not.toHaveBeenCalled();
  });

  it("does not verify when person has no pre-existing email", async () => {
    // Person has no email yet
    mockPrismaPersonFindUnique.mockResolvedValue({
      id: "p1",
      email: null,
      source: "discovery-prospeo",
    });

    const breaker = createCircuitBreaker();
    await enrichEmail(
      "p1",
      {
        firstName: "Jane",
        lastName: "Doe",
        companyDomain: "example.com",
        discoverySource: "prospeo",
      },
      breaker,
    );

    // No pre-existing email — BounceBan should not be called for verification
    // (it would only be called if an email provider finds one, but shouldEnrich is mocked to skip all)
    expect(mockBouncebanVerify).not.toHaveBeenCalled();
  });
});
