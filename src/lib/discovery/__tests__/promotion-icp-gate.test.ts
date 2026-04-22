import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Prisma mock ---
const discoveredPersonFindManyMock = vi.fn();
const discoveredPersonUpdateMock = vi.fn();
const personFindManyMock = vi.fn();
const personUpsertMock = vi.fn();
const personFindFirstMock = vi.fn();
const personCreateMock = vi.fn();
const personWorkspaceUpsertMock = vi.fn();
const workspaceFindUniqueOrThrowMock = vi.fn();
const campaignFindUniqueMock = vi.fn();
const companyFindManyMock = vi.fn();
const exclusionEntryFindManyMock = vi.fn();
const exclusionEmailFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    discoveredPerson: {
      findMany: (...args: unknown[]) => discoveredPersonFindManyMock(...args),
      update: (...args: unknown[]) => discoveredPersonUpdateMock(...args),
    },
    person: {
      findMany: (...args: unknown[]) => personFindManyMock(...args),
      upsert: (...args: unknown[]) => personUpsertMock(...args),
      findFirst: (...args: unknown[]) => personFindFirstMock(...args),
      create: (...args: unknown[]) => personCreateMock(...args),
    },
    personWorkspace: {
      upsert: (...args: unknown[]) => personWorkspaceUpsertMock(...args),
    },
    workspace: {
      findUniqueOrThrow: (...args: unknown[]) => workspaceFindUniqueOrThrowMock(...args),
    },
    campaign: {
      findUnique: (...args: unknown[]) => campaignFindUniqueMock(...args),
    },
    company: {
      findMany: (...args: unknown[]) => companyFindManyMock(...args),
    },
    exclusionEntry: {
      findMany: (...args: unknown[]) => exclusionEntryFindManyMock(...args),
    },
    exclusionEmail: {
      findMany: (...args: unknown[]) => exclusionEmailFindManyMock(...args),
    },
  },
}));

// --- Enrichment queue mock ---
const enqueueJobMock = vi.fn();
vi.mock("@/lib/enrichment/queue", () => ({
  enqueueJob: (...args: unknown[]) => enqueueJobMock(...args),
}));

// --- ICP scorer mock ---
const scoreStagedPersonIcpBatchMock = vi.fn();
vi.mock("@/lib/icp/scorer", () => ({
  ICP_NEEDS_WEBSITE_STATUS: "needs_website",
  scoreStagedPersonIcpBatch: (...args: unknown[]) => scoreStagedPersonIcpBatchMock(...args),
}));

// --- Crawl cache prefetch mock ---
const prefetchDomainsMock = vi.fn();
vi.mock("@/lib/icp/crawl-cache", () => ({
  prefetchDomains: (...args: unknown[]) => prefetchDomainsMock(...args),
}));

import { deduplicateAndPromote } from "../promotion";

beforeEach(() => {
  vi.clearAllMocks();

  // Default: no existing people (no dupes)
  personFindManyMock.mockResolvedValue([]);
  personUpsertMock.mockImplementation(async (args: { create: { email: string } }) => ({
    id: `person-${args.create.email ?? "nomail"}`,
  }));
  personCreateMock.mockImplementation(async () => ({ id: "person-created" }));
  personFindFirstMock.mockResolvedValue(null);
  personWorkspaceUpsertMock.mockResolvedValue({});
  discoveredPersonUpdateMock.mockResolvedValue({});
  enqueueJobMock.mockResolvedValue("job-123");
  prefetchDomainsMock.mockResolvedValue({ cached: 0, crawled: 0, failed: 0 });
  companyFindManyMock.mockResolvedValue([]);
  exclusionEntryFindManyMock.mockResolvedValue([]);
  exclusionEmailFindManyMock.mockResolvedValue([]);
  campaignFindUniqueMock.mockResolvedValue(null);
});

function makeStagedRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "dp-1",
    email: "john@acme.com",
    firstName: "John",
    lastName: "Doe",
    jobTitle: "CTO",
    company: "Acme Corp",
    companyDomain: "acme.com",
    linkedinUrl: "https://linkedin.com/in/johndoe",
    phone: null,
    location: "London, UK",
    discoverySource: "prospeo",
    workspaceSlug: "test",
    rawResponse: null,
    ...overrides,
  };
}

describe("deduplicateAndPromote — ICP scoring gate (BL-038)", () => {
  it("promotes without scoring when workspace has no icpCriteriaPrompt", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      slug: "test",
      icpCriteriaPrompt: null,
      icpScoreThreshold: null,
    });

    discoveredPersonFindManyMock.mockResolvedValue([makeStagedRecord()]);

    const result = await deduplicateAndPromote("test", ["run-1"]);

    expect(result.promoted).toBe(1);
    expect(result.scoredRejected).toBe(0);
    expect(scoreStagedPersonIcpBatchMock).not.toHaveBeenCalled();
  });

  it("scores and promotes when score >= threshold", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      slug: "test",
      icpCriteriaPrompt: "ICP: B2B SaaS",
      icpScoreThreshold: 40,
    });

    discoveredPersonFindManyMock.mockResolvedValue([makeStagedRecord()]);

    scoreStagedPersonIcpBatchMock.mockResolvedValue(
      new Map([["dp-1", { status: "scored", score: 75, reasoning: "Good fit", confidence: "high", scoringMethod: "firecrawl+llm" }]]),
    );

    const result = await deduplicateAndPromote("test", ["run-1"]);

    expect(result.promoted).toBe(1);
    expect(result.scoredRejected).toBe(0);
    expect(scoreStagedPersonIcpBatchMock).toHaveBeenCalledTimes(1);

    // Verify score was persisted on DiscoveredPerson
    const updateCalls = discoveredPersonUpdateMock.mock.calls;
    const scoreUpdate = updateCalls.find(
      (call: unknown[]) => (call[0] as { data: { icpScore?: number } }).data.icpScore === 75,
    );
    expect(scoreUpdate).toBeDefined();
  });

  it("rejects when score < threshold", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      slug: "test",
      icpCriteriaPrompt: "ICP: B2B SaaS",
      icpScoreThreshold: 40,
    });

    discoveredPersonFindManyMock.mockResolvedValue([makeStagedRecord()]);

    scoreStagedPersonIcpBatchMock.mockResolvedValue(
      new Map([["dp-1", { status: "scored", score: 25, reasoning: "Poor fit", confidence: "medium", scoringMethod: "firecrawl+llm" }]]),
    );

    const result = await deduplicateAndPromote("test", ["run-1"]);

    expect(result.promoted).toBe(0);
    expect(result.scoredRejected).toBe(1);

    // Verify status set to scored_rejected
    const updateCalls = discoveredPersonUpdateMock.mock.calls;
    const rejectUpdate = updateCalls.find(
      (call: unknown[]) => (call[0] as { data: { status?: string } }).data.status === "scored_rejected",
    );
    expect(rejectUpdate).toBeDefined();
  });

  it("uses default threshold (40) when workspace has no explicit threshold", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      slug: "test",
      icpCriteriaPrompt: "ICP: B2B SaaS",
      icpScoreThreshold: null, // no explicit threshold
    });

    discoveredPersonFindManyMock.mockResolvedValue([makeStagedRecord()]);

    scoreStagedPersonIcpBatchMock.mockResolvedValue(
      new Map([["dp-1", { status: "scored", score: 39, reasoning: "Below threshold", confidence: "medium", scoringMethod: "firecrawl+llm" }]]),
    );

    const result = await deduplicateAndPromote("test", ["run-1"]);

    expect(result.promoted).toBe(0);
    expect(result.scoredRejected).toBe(1);
  });

  it("fails closed when scoring throws an error", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      slug: "test",
      icpCriteriaPrompt: "ICP: B2B SaaS",
      icpScoreThreshold: 40,
    });

    discoveredPersonFindManyMock.mockResolvedValue([makeStagedRecord()]);

    scoreStagedPersonIcpBatchMock.mockRejectedValue(new Error("API rate limit"));

    await expect(deduplicateAndPromote("test", ["run-1"])).rejects.toThrow(
      /refusing to promote unscored candidates/i,
    );
    expect(personUpsertMock).not.toHaveBeenCalled();
    expect(personCreateMock).not.toHaveBeenCalled();
  });

  it("pre-fetches domains before scoring loop", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      slug: "test",
      icpCriteriaPrompt: "ICP: B2B SaaS",
      icpScoreThreshold: 40,
    });

    discoveredPersonFindManyMock.mockResolvedValue([
      makeStagedRecord({ id: "dp-1", companyDomain: "acme.com" }),
      makeStagedRecord({ id: "dp-2", companyDomain: "beta.com", email: "jane@beta.com" }),
    ]);

    scoreStagedPersonIcpBatchMock.mockResolvedValue(
      new Map([
        ["dp-1", { status: "scored", score: 80, reasoning: "Good fit", confidence: "high" as const, scoringMethod: "firecrawl+llm" }],
        ["dp-2", { status: "scored", score: 80, reasoning: "Good fit", confidence: "high" as const, scoringMethod: "firecrawl+llm" }],
      ]),
    );

    await deduplicateAndPromote("test", ["run-1"]);

    // prefetchDomains should be called once with all domains
    expect(prefetchDomainsMock).toHaveBeenCalledTimes(1);
    const domains = prefetchDomainsMock.mock.calls[0][0];
    expect(domains).toContain("acme.com");
    expect(domains).toContain("beta.com");
  });

  it("creates a PersonWorkspace link for duplicates found in another workspace", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      slug: "test",
      icpCriteriaPrompt: null,
      icpScoreThreshold: null,
    });

    discoveredPersonFindManyMock.mockResolvedValue([
      makeStagedRecord({ id: "dp-duplicate", email: "shared@acme.com" }),
    ]);
    personFindManyMock.mockResolvedValue([
      { id: "person-existing", email: "shared@acme.com" },
    ]);

    const result = await deduplicateAndPromote("test", ["run-1"]);

    expect(result.promoted).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(personUpsertMock).not.toHaveBeenCalled();
    expect(personCreateMock).not.toHaveBeenCalled();
    expect(personWorkspaceUpsertMock).toHaveBeenCalledWith({
      where: {
        personId_workspace: {
          personId: "person-existing",
          workspace: "test",
        },
      },
      create: {
        personId: "person-existing",
        workspace: "test",
        sourceId: null,
      },
      update: {},
    });
  });

  it("rejects leads without website evidence instead of promoting them", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      slug: "test",
      icpCriteriaPrompt: "ICP: B2B SaaS",
      icpScoreThreshold: 40,
    });

    discoveredPersonFindManyMock.mockResolvedValue([makeStagedRecord({ id: "dp-needs-website" })]);
    scoreStagedPersonIcpBatchMock.mockResolvedValue(
      new Map([
        [
          "dp-needs-website",
          {
            status: "needs_website",
            reasoning: "NEEDS_WEBSITE: company website content unavailable",
            confidence: "low" as const,
            scoringMethod: null,
          },
        ],
      ]),
    );

    const result = await deduplicateAndPromote("test", ["run-1"]);

    expect(result.promoted).toBe(0);
    expect(result.scoredRejected).toBe(1);
    expect(discoveredPersonUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dp-needs-website" },
        data: expect.objectContaining({
          status: "scored_rejected",
          icpScore: null,
          icpReasoning: expect.stringContaining("NEEDS_WEBSITE"),
        }),
      }),
    );
  });

  it("skips enrichment queue for linkedin-only campaigns", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      slug: "test",
      icpCriteriaPrompt: null,
      icpScoreThreshold: null,
    });
    campaignFindUniqueMock.mockResolvedValue({ channels: "[\"linkedin\"]" });
    discoveredPersonFindManyMock.mockResolvedValue([makeStagedRecord({ id: "dp-linkedin" })]);

    const result = await deduplicateAndPromote("test", ["run-1"], {
      campaignId: "camp-linkedin",
    });

    expect(result.promoted).toBe(1);
    expect(result.enrichmentJobId).toBeUndefined();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});
