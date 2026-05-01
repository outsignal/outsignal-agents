import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  prismaPersonFindUnique: vi.fn(),
  prismaPersonUpdate: vi.fn(),
  prismaEnrichmentLogFindFirst: vi.fn(),
  shouldEnrich: vi.fn(),
  recordEnrichment: vi.fn(),
  checkDailyCap: vi.fn(),
  incrementDailySpend: vi.fn(),
  mergePersonData: vi.fn(),
  mergeCompanyData: vi.fn(),
  bouncebanVerify: vi.fn(),
  bulkVerifyEmails: vi.fn(),
  kittVerify: vi.fn(),
  kittFindEmail: vi.fn(),
  bulkEnrichByAiArkId: vi.fn(),
  aiarkPersonAdapter: vi.fn(),
  prospeoAdapter: vi.fn(),
  bulkEnrichPerson: vi.fn(),
  bulkEnrichByPersonId: vi.fn(),
  findymailAdapter: vi.fn(),
  bulkFindEmail: vi.fn(),
  kittAdapter: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: (...args: unknown[]) => mocks.prismaPersonFindUnique(...args),
      update: (...args: unknown[]) => mocks.prismaPersonUpdate(...args),
    },
    enrichmentLog: {
      findFirst: (...args: unknown[]) => mocks.prismaEnrichmentLogFindFirst(...args),
    },
  },
}));

vi.mock("@/lib/enrichment/dedup", () => ({
  shouldEnrich: (...args: unknown[]) => mocks.shouldEnrich(...args),
}));

vi.mock("@/lib/enrichment/log", () => ({
  recordEnrichment: (...args: unknown[]) => mocks.recordEnrichment(...args),
}));

vi.mock("@/lib/enrichment/costs", () => ({
  checkDailyCap: (...args: unknown[]) => mocks.checkDailyCap(...args),
  incrementDailySpend: (...args: unknown[]) => mocks.incrementDailySpend(...args),
  PROVIDER_COSTS: {
    aiark: 0.003,
    prospeo: 0.002,
    findymail: 0.001,
    "kitt-find": 0.005,
  },
}));

vi.mock("@/lib/enrichment/merge", () => ({
  mergePersonData: (...args: unknown[]) => mocks.mergePersonData(...args),
  mergeCompanyData: (...args: unknown[]) => mocks.mergeCompanyData(...args),
}));

vi.mock("@/lib/verification/bounceban", () => ({
  verifyEmail: (...args: unknown[]) => mocks.bouncebanVerify(...args),
  bulkVerifyEmails: (...args: unknown[]) => mocks.bulkVerifyEmails(...args),
}));

vi.mock("@/lib/verification/kitt", () => ({
  verifyEmail: (...args: unknown[]) => mocks.kittVerify(...args),
  findEmail: (...args: unknown[]) => mocks.kittFindEmail(...args),
}));

vi.mock("@/lib/enrichment/providers/aiark-source-first", () => ({
  bulkEnrichByAiArkId: (...args: unknown[]) => mocks.bulkEnrichByAiArkId(...args),
}));

vi.mock("@/lib/enrichment/providers/aiark-person", () => ({
  aiarkPersonAdapter: (...args: unknown[]) => mocks.aiarkPersonAdapter(...args),
}));

vi.mock("@/lib/enrichment/providers/prospeo", () => ({
  prospeoAdapter: (...args: unknown[]) => mocks.prospeoAdapter(...args),
  bulkEnrichPerson: (...args: unknown[]) => mocks.bulkEnrichPerson(...args),
  bulkEnrichByPersonId: (...args: unknown[]) => mocks.bulkEnrichByPersonId(...args),
}));

vi.mock("@/lib/enrichment/providers/findymail", () => ({
  findymailAdapter: (...args: unknown[]) => mocks.findymailAdapter(...args),
  bulkFindEmail: (...args: unknown[]) => mocks.bulkFindEmail(...args),
}));

vi.mock("@/lib/enrichment/providers/kitt", () => ({
  kittAdapter: (...args: unknown[]) => mocks.kittAdapter(...args),
}));

vi.mock("@/lib/enrichment/providers/aiark", () => ({
  aiarkAdapter: vi.fn(),
}));

vi.mock("@/lib/enrichment/providers/firecrawl-company", () => ({
  firecrawlCompanyAdapter: vi.fn(),
}));

vi.mock("@/lib/normalizer", () => ({
  classifyIndustry: vi.fn(),
  classifyJobTitle: vi.fn(),
  classifyCompanyName: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  notifyCreditExhaustion: vi.fn(),
}));

import { createCircuitBreaker, enrichEmail, enrichEmailBatch } from "../waterfall";

describe("W6 stage 2 AI Ark identity deprecation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prismaPersonFindUnique.mockResolvedValue({ email: null, source: null });
    mocks.shouldEnrich.mockResolvedValue(false);
    mocks.checkDailyCap.mockResolvedValue(false);
    mocks.incrementDailySpend.mockResolvedValue(undefined);
    mocks.recordEnrichment.mockResolvedValue(undefined);
    mocks.mergePersonData.mockResolvedValue(["email"]);
    mocks.mergeCompanyData.mockResolvedValue([]);
    mocks.bouncebanVerify.mockResolvedValue({
      status: "valid",
      email: "verified@example.com",
      costUsd: 0.001,
    });
    mocks.bulkVerifyEmails.mockResolvedValue(
      new Map([
        [
          "person-prospeo",
          { status: "valid", email: "source-first@example.com", costUsd: 0.001 },
        ],
      ]),
    );
  });

  it("keeps AI Ark source-first lookup but does not fire generic AI Ark identity", async () => {
    mocks.bulkEnrichByAiArkId.mockResolvedValue(
      new Map([
        [
          "person-aiark",
          {
            email: "aiark@example.com",
            rawResponse: { id: "aiark-123" },
            costUsd: 0.003,
            source: "aiark",
          },
        ],
      ]),
    );

    await enrichEmail(
      "person-aiark",
      {
        firstName: "Ada",
        lastName: "Lovelace",
        companyDomain: "example.com",
        discoverySource: "aiark",
        sourceId: "aiark-123",
      },
      createCircuitBreaker(),
    );

    expect(mocks.bulkEnrichByAiArkId).toHaveBeenCalledWith([
      { personId: "person-aiark", aiarkPersonId: "aiark-123" },
    ]);
    expect(mocks.aiarkPersonAdapter).not.toHaveBeenCalled();
    expect(mocks.mergePersonData).toHaveBeenCalledWith("person-aiark", {
      email: "aiark@example.com",
    });
  });

  it("keeps Prospeo source-first lookup but does not fire generic AI Ark identity", async () => {
    mocks.shouldEnrich.mockResolvedValue(true);
    mocks.bulkEnrichByPersonId.mockResolvedValue(
      new Map([
        [
          "person-prospeo",
          {
            email: "source-first@example.com",
            rawResponse: { person: { person_id: "prospeo-123" } },
            costUsd: 0.002,
            source: "prospeo",
          },
        ],
      ]),
    );

    await enrichEmailBatch(
      [
        {
          personId: "person-prospeo",
          firstName: "Grace",
          lastName: "Hopper",
          companyDomain: "example.com",
          discoverySource: "prospeo",
          sourceId: "prospeo-123",
        },
      ],
      createCircuitBreaker(),
    );

    expect(mocks.bulkEnrichByPersonId).toHaveBeenCalledWith([
      { personId: "person-prospeo", prospeoPersonId: "prospeo-123" },
    ]);
    expect(mocks.bulkEnrichPerson).not.toHaveBeenCalled();
    expect(mocks.aiarkPersonAdapter).not.toHaveBeenCalled();
    expect(mocks.mergePersonData).toHaveBeenCalledWith("person-prospeo", {
      email: "source-first@example.com",
    });
  });

  it("includes AI Ark source-first emails in BounceBan bulk verification", async () => {
    mocks.bulkEnrichByAiArkId.mockResolvedValue(
      new Map([
        [
          "person-aiark",
          {
            email: "aiark@example.com",
            rawResponse: { id: "aiark-123" },
            costUsd: 0.003,
            source: "aiark",
          },
        ],
      ]),
    );
    mocks.bulkVerifyEmails.mockResolvedValue(
      new Map([
        [
          "person-aiark",
          { status: "valid", email: "aiark@example.com", costUsd: 0.001 },
        ],
      ]),
    );

    await enrichEmailBatch(
      [
        {
          personId: "person-aiark",
          firstName: "Ada",
          lastName: "Lovelace",
          companyDomain: "example.com",
          discoverySource: "aiark",
          sourceId: "aiark-123",
        },
      ],
      createCircuitBreaker(),
    );

    expect(mocks.bulkVerifyEmails).toHaveBeenCalledWith([
      { email: "aiark@example.com", personId: "person-aiark" },
    ]);
    expect(mocks.mergePersonData).toHaveBeenCalledWith("person-aiark", {
      email: "aiark@example.com",
    });
  });

  it("falls back to Kitt verify when BounceBan bulk has a non-credit error", async () => {
    mocks.bulkVerifyEmails.mockRejectedValue(new Error("BounceBan unavailable"));
    mocks.kittVerify.mockResolvedValue({
      status: "valid",
      email: "existing@example.com",
      costUsd: 0.0015,
    });

    await enrichEmailBatch(
      [
        {
          personId: "person-existing",
          email: "existing@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          companyDomain: "example.com",
          discoverySource: "prospeo",
        },
      ],
      createCircuitBreaker(),
    );

    expect(mocks.kittVerify).toHaveBeenCalledWith("existing@example.com", "person-existing");
    expect(mocks.mergePersonData).toHaveBeenCalledWith("person-existing", {
      email: "existing@example.com",
    });
  });

  it("runs and records Kitt find in batch when Prospeo misses a lead with name and domain", async () => {
    mocks.shouldEnrich.mockResolvedValue(true);
    mocks.bulkEnrichPerson.mockResolvedValue(
      new Map([
        [
          "person-kitt",
          {
            email: null,
            rawResponse: { provider: "prospeo", result: null },
            costUsd: 0.002,
            source: "prospeo",
          },
        ],
      ]),
    );
    mocks.kittFindEmail.mockResolvedValue({
      email: "kitt@example.com",
      confidence: 0.91,
      costUsd: 0.005,
      rawResponse: { id: "kitt-job-1", result: { email: "kitt@example.com" } },
    });
    mocks.bulkVerifyEmails.mockResolvedValue(
      new Map([
        [
          "person-kitt",
          { status: "valid", email: "kitt@example.com", costUsd: 0.001 },
        ],
      ]),
    );

    const summary = await enrichEmailBatch(
      [
        {
          personId: "person-kitt",
          firstName: "Ada",
          lastName: "Lovelace",
          companyDomain: "example.com",
        },
      ],
      createCircuitBreaker(),
      "1210-solutions",
    );

    expect(mocks.kittFindEmail).toHaveBeenCalledWith({
      fullName: "Ada Lovelace",
      domain: "example.com",
      linkedinUrl: undefined,
      personId: "person-kitt",
      log: false,
    });
    expect(mocks.recordEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "person-kitt",
        entityType: "person",
        provider: "kitt-find",
        status: "success",
        fieldsWritten: ["email"],
        costUsd: 0.005,
        rawResponse: { id: "kitt-job-1", result: { email: "kitt@example.com" } },
        workspaceSlug: "1210-solutions",
      }),
    );
    expect(mocks.mergePersonData).toHaveBeenCalledWith("person-kitt", {
      email: "kitt@example.com",
    });
    expect(summary.costs["kitt-find"]).toBe(0.005);
  });

  it("does not run or record Kitt find in batch when Prospeo finds an email", async () => {
    mocks.shouldEnrich.mockResolvedValue(true);
    mocks.bulkEnrichPerson.mockResolvedValue(
      new Map([
        [
          "person-prospeo-email",
          {
            email: "prospeo@example.com",
            rawResponse: { provider: "prospeo", email: "prospeo@example.com" },
            costUsd: 0.002,
            source: "prospeo",
          },
        ],
      ]),
    );
    mocks.bulkVerifyEmails.mockResolvedValue(
      new Map([
        [
          "person-prospeo-email",
          { status: "valid", email: "prospeo@example.com", costUsd: 0.001 },
        ],
      ]),
    );

    await enrichEmailBatch(
      [
        {
          personId: "person-prospeo-email",
          firstName: "Grace",
          lastName: "Hopper",
          companyDomain: "example.com",
        },
      ],
      createCircuitBreaker(),
    );

    expect(mocks.kittFindEmail).not.toHaveBeenCalled();
    expect(mocks.recordEnrichment).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "kitt-find" }),
    );
  });

  it("skips Kitt find in batch when Prospeo misses but name/domain inputs are incomplete", async () => {
    mocks.shouldEnrich.mockResolvedValue(true);
    mocks.bulkEnrichPerson.mockResolvedValue(
      new Map([
        [
          "person-no-domain",
          {
            email: null,
            rawResponse: { provider: "prospeo", result: null },
            costUsd: 0.002,
            source: "prospeo",
          },
        ],
      ]),
    );

    await enrichEmailBatch(
      [
        {
          personId: "person-no-domain",
          firstName: "Katherine",
          lastName: "Johnson",
        },
      ],
      createCircuitBreaker(),
    );

    expect(mocks.kittFindEmail).not.toHaveBeenCalled();
    expect(mocks.recordEnrichment).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "kitt-find" }),
    );
  });

  it("keeps single-path Kitt logging through the normal waterfall adapter", async () => {
    mocks.shouldEnrich.mockResolvedValue(true);
    mocks.prospeoAdapter.mockResolvedValue({
      email: null,
      rawResponse: { provider: "prospeo", result: null },
      costUsd: 0.002,
      source: "prospeo",
    });
    mocks.kittAdapter.mockResolvedValue({
      email: "single-kitt@example.com",
      rawResponse: { id: "single-kitt-job" },
      costUsd: 0.005,
      source: "kitt-find",
    });
    mocks.bouncebanVerify.mockResolvedValue({
      status: "valid",
      email: "single-kitt@example.com",
      costUsd: 0.001,
    });

    await enrichEmail(
      "person-single-kitt",
      {
        firstName: "Dorothy",
        lastName: "Vaughan",
        companyDomain: "example.com",
      },
      createCircuitBreaker(),
      "1210-solutions",
    );

    expect(mocks.recordEnrichment).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "person-single-kitt",
        provider: "kitt-find",
        status: "success",
        fieldsWritten: ["email"],
        rawResponse: { id: "single-kitt-job" },
        workspaceSlug: "1210-solutions",
      }),
    );
    expect(mocks.mergePersonData).toHaveBeenCalledWith("person-single-kitt", {
      email: "single-kitt@example.com",
    });
  });
});
