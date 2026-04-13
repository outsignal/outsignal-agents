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
  });
});
