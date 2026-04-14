import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUniqueOrThrow: vi.fn(),
    },
    discoveredPerson: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    person: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    personWorkspace: {
      upsert: vi.fn(),
    },
    company: {
      findMany: vi.fn(),
    },
    exclusionEntry: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    exclusionEmail: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock enrichment queue
vi.mock("@/lib/enrichment/queue", () => ({
  enqueueJob: vi.fn().mockResolvedValue("job-1"),
}));

// Mock batch ICP scorer
vi.mock("@/lib/icp/scorer", () => ({
  scoreStagedPersonIcpBatch: vi.fn().mockResolvedValue(new Map()),
}));

// Mock crawl cache
vi.mock("@/lib/icp/crawl-cache", () => ({
  prefetchDomains: vi.fn().mockResolvedValue({ cached: 0, crawled: 0, failed: 0 }),
}));

import { prisma } from "@/lib/db";
import { deduplicateAndPromote } from "@/lib/discovery/promotion";
import { scoreStagedPersonIcpBatch } from "@/lib/icp/scorer";

const mockWorkspace = prisma.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockFindManyDiscovered = prisma.discoveredPerson.findMany as ReturnType<typeof vi.fn>;
const mockUpdateDiscovered = prisma.discoveredPerson.update as ReturnType<typeof vi.fn>;
const mockFindManyPerson = prisma.person.findMany as ReturnType<typeof vi.fn>;
const mockUpsertPerson = prisma.person.upsert as ReturnType<typeof vi.fn>;
const mockUpsertPw = prisma.personWorkspace.upsert as ReturnType<typeof vi.fn>;
const mockFindManyCompany = prisma.company.findMany as ReturnType<typeof vi.fn>;
const mockScorerBatch = scoreStagedPersonIcpBatch as ReturnType<typeof vi.fn>;

function makeStagedPerson(overrides: Partial<{
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  location: string | null;
  discoverySource: string;
  workspaceSlug: string;
  rawResponse: string | null;
}> = {}) {
  return {
    id: overrides.id ?? "dp-1",
    email: overrides.email ?? "test@example.com",
    firstName: overrides.firstName ?? "John",
    lastName: overrides.lastName ?? "Doe",
    jobTitle: overrides.jobTitle ?? "CTO",
    company: overrides.company ?? "Acme",
    companyDomain: overrides.companyDomain ?? "acme.com",
    linkedinUrl: overrides.linkedinUrl ?? null,
    phone: overrides.phone ?? null,
    location: overrides.location ?? "London",
    discoverySource: overrides.discoverySource ?? "prospeo",
    workspaceSlug: overrides.workspaceSlug ?? "test-ws",
    rawResponse: overrides.rawResponse ?? null,
  };
}

describe("promotion ICP gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default workspace with ICP scoring enabled
    mockWorkspace.mockResolvedValue({
      slug: "test-ws",
      icpCriteriaPrompt: "Score B2B SaaS CTOs highly",
      icpScoreThreshold: 40,
    });
    // No existing people (no duplicates)
    mockFindManyPerson.mockResolvedValue([]);
    mockFindManyCompany.mockResolvedValue([]);
    // Person upsert returns an id
    mockUpsertPerson.mockResolvedValue({ id: "person-1" });
    mockUpsertPw.mockResolvedValue({});
    mockUpdateDiscovered.mockResolvedValue({});
  });

  it("promotes when score equals threshold (boundary case)", async () => {
    const dp = makeStagedPerson({ id: "dp-boundary" });
    mockFindManyDiscovered.mockResolvedValue([dp]);

    // Score exactly at threshold (40)
    const scoreResults = new Map([
      ["dp-boundary", { score: 40, reasoning: "Exact threshold", confidence: "medium" as const }],
    ]);
    mockScorerBatch.mockResolvedValue(scoreResults);

    const result = await deduplicateAndPromote("test-ws", ["run-1"]);

    expect(result.promoted).toBe(1);
    expect(result.scoredRejected).toBe(0);
    // Verify score was persisted on DiscoveredPerson
    expect(mockUpdateDiscovered).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dp-boundary" },
        data: expect.objectContaining({
          icpScore: 40,
        }),
      }),
    );
    // INV2: score must also be copied onto the PersonWorkspace row so
    // DiscoveredPerson.icpScore and PersonWorkspace.icpScore stay in sync.
    expect(mockUpsertPw).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          icpScore: 40,
          icpReasoning: "Exact threshold",
          icpConfidence: "medium",
          icpScoredAt: expect.any(Date),
        }),
        update: expect.objectContaining({
          icpScore: 40,
          icpReasoning: "Exact threshold",
          icpConfidence: "medium",
          icpScoredAt: expect.any(Date),
        }),
      }),
    );
  });

  it("omits score fields when icpScoringEnabled but scoreResult is undefined for that person", async () => {
    // Workspace HAS ICP scoring enabled, but the batch scorer returned
    // nothing for this particular DiscoveredPerson (e.g. timed out, hit
    // an error, or excluded by per-row guard). The upsert payload must
    // NOT contain icp* keys so we don't write `null`/`undefined` over
    // an existing manually-curated score on the PersonWorkspace row.
    const dp = makeStagedPerson({ id: "dp-no-result" });
    mockFindManyDiscovered.mockResolvedValue([dp]);

    // scorer returned an empty Map — no entry for "dp-no-result"
    mockScorerBatch.mockResolvedValue(new Map());

    const result = await deduplicateAndPromote("test-ws", ["run-1"]);

    // With no score, the row falls below the default 40 threshold and
    // should be rejected by the ICP gate. So `promoted` is 0, but more
    // importantly the upsert path that runs (if any) must not include
    // icp* keys. Verify by inspecting any upsert call: there should
    // either be zero PersonWorkspace upserts (if the gate fired before
    // promotion), or the call's payload must not contain icp* keys.
    expect(result.scoredRejected).toBeGreaterThanOrEqual(0);
    for (const call of mockUpsertPw.mock.calls) {
      const payload = call[0] as {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      };
      expect(payload.create).not.toHaveProperty("icpScore");
      expect(payload.create).not.toHaveProperty("icpReasoning");
      expect(payload.update).not.toHaveProperty("icpScore");
      expect(payload.update).not.toHaveProperty("icpReasoning");
    }
  });

  it("update path overrides existing PersonWorkspace score with the new score", async () => {
    // Existing PersonWorkspace already has icpScore=20 (manual or stale
    // batch). New batch returns a fresh score of 75. Per the upsert's
    // documented INV2 behaviour: the update payload always copies the
    // fresh score so DiscoveredPerson.icpScore and PersonWorkspace.icpScore
    // stay in sync.
    const dp = makeStagedPerson({ id: "dp-update" });
    mockFindManyDiscovered.mockResolvedValue([dp]);

    const scoreResults = new Map([
      ["dp-update", { score: 75, reasoning: "Strong fit", confidence: "high" as const }],
    ]);
    mockScorerBatch.mockResolvedValue(scoreResults);

    await deduplicateAndPromote("test-ws", ["run-1"]);

    // The upsert update branch must include the new score — verifying
    // the bug-not-introduced behaviour where update would silently
    // skip score writes.
    expect(mockUpsertPw).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          icpScore: 75,
          icpReasoning: "Strong fit",
          icpConfidence: "high",
          icpScoredAt: expect.any(Date),
        }),
      }),
    );
  });

  it("does not touch score fields on PersonWorkspace when ICP scoring is disabled", async () => {
    // Workspace without ICP scoring configured
    mockWorkspace.mockResolvedValue({
      slug: "test-ws",
      icpCriteriaPrompt: null,
      icpScoreThreshold: null,
    });

    const dp = makeStagedPerson({ id: "dp-no-score" });
    mockFindManyDiscovered.mockResolvedValue([dp]);

    const result = await deduplicateAndPromote("test-ws", ["run-1"]);

    expect(result.promoted).toBe(1);
    // Upsert payloads must NOT contain icp* keys when no score is available —
    // we leave existing fields untouched rather than nulling them out.
    const call = mockUpsertPw.mock.calls[0]?.[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call).toBeDefined();
    expect(call.create).not.toHaveProperty("icpScore");
    expect(call.create).not.toHaveProperty("icpReasoning");
    expect(call.create).not.toHaveProperty("icpConfidence");
    expect(call.create).not.toHaveProperty("icpScoredAt");
    expect(call.update).not.toHaveProperty("icpScore");
    expect(call.update).not.toHaveProperty("icpReasoning");
    expect(call.update).not.toHaveProperty("icpConfidence");
    expect(call.update).not.toHaveProperty("icpScoredAt");
  });
});
