import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findMany: vi.fn(),
    },
    targetListPerson: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { detectOverlaps } from "@/lib/campaigns/overlap-detection";

const mockPersonFindMany = prisma.person.findMany as ReturnType<typeof vi.fn>;
const mockTlpFindMany = prisma.targetListPerson.findMany as ReturnType<typeof vi.fn>;

describe("detectOverlaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array for empty candidate list", async () => {
    const result = await detectOverlaps({
      workspaceSlug: "rise",
      candidatePersonIds: [],
    });
    expect(result).toEqual([]);
  });

  it("returns empty array when no overlaps found", async () => {
    mockPersonFindMany.mockResolvedValue([
      { id: "p1", email: "john@acme.com", linkedinUrl: null, firstName: "John", lastName: "Smith" },
    ]);
    mockTlpFindMany.mockResolvedValue([]);

    const result = await detectOverlaps({
      workspaceSlug: "rise",
      candidatePersonIds: ["p1"],
    });
    expect(result).toEqual([]);
  });

  it("returns overlap records matching on email", async () => {
    mockPersonFindMany.mockResolvedValue([
      { id: "p1", email: "john@acme.com", linkedinUrl: null, firstName: "John", lastName: "Smith" },
    ]);
    mockTlpFindMany.mockResolvedValue([
      {
        person: { id: "p1", email: "john@acme.com", linkedinUrl: null, firstName: "John", lastName: "Smith" },
        list: {
          campaigns: [{ id: "c-other", name: "Rise Campaign #3" }],
        },
      },
    ]);

    const result = await detectOverlaps({
      workspaceSlug: "rise",
      candidatePersonIds: ["p1"],
    });
    expect(result.length).toBe(1);
    expect(result[0].personEmail).toBe("john@acme.com");
    expect(result[0].overlappingCampaignName).toBe("Rise Campaign #3");
    expect(result[0].overlapField).toBe("email");
  });

  it("returns overlap records matching on linkedinUrl", async () => {
    mockPersonFindMany.mockResolvedValue([
      { id: "p2", email: null, linkedinUrl: "https://linkedin.com/in/jane", firstName: "Jane", lastName: "Doe" },
    ]);
    mockTlpFindMany.mockResolvedValue([
      {
        person: { id: "p2", email: null, linkedinUrl: "https://linkedin.com/in/jane", firstName: "Jane", lastName: "Doe" },
        list: {
          campaigns: [{ id: "c-other-2", name: "Rise LinkedIn Q1" }],
        },
      },
    ]);

    const result = await detectOverlaps({
      workspaceSlug: "rise",
      candidatePersonIds: ["p2"],
    });
    expect(result.length).toBe(1);
    expect(result[0].overlapField).toBe("linkedinUrl");
    expect(result[0].overlappingCampaignName).toBe("Rise LinkedIn Q1");
  });

  it("names the overlapping campaign in the returned warning", async () => {
    mockPersonFindMany.mockResolvedValue([
      { id: "p1", email: "john@acme.com", linkedinUrl: null, firstName: "John", lastName: "Smith" },
    ]);
    mockTlpFindMany.mockResolvedValue([
      {
        person: { id: "p1", email: "john@acme.com", linkedinUrl: null, firstName: "John", lastName: "Smith" },
        list: {
          campaigns: [{ id: "c-active", name: "Acme Q1 Campaign" }],
        },
      },
    ]);

    const result = await detectOverlaps({
      workspaceSlug: "rise",
      candidatePersonIds: ["p1"],
    });
    expect(result[0].overlappingCampaignName).toBe("Acme Q1 Campaign");
    expect(result[0].overlappingCampaignId).toBe("c-active");
  });

  it("deduplicates person+campaign combinations", async () => {
    mockPersonFindMany.mockResolvedValue([
      { id: "p1", email: "john@acme.com", linkedinUrl: "https://linkedin.com/in/john", firstName: "John", lastName: "Smith" },
    ]);
    // Same person appears in two TLP records for the same campaign
    mockTlpFindMany.mockResolvedValue([
      {
        person: { id: "p1", email: "john@acme.com", linkedinUrl: "https://linkedin.com/in/john", firstName: "John", lastName: "Smith" },
        list: { campaigns: [{ id: "c1", name: "Campaign A" }] },
      },
      {
        person: { id: "p1", email: "john@acme.com", linkedinUrl: "https://linkedin.com/in/john", firstName: "John", lastName: "Smith" },
        list: { campaigns: [{ id: "c1", name: "Campaign A" }] },
      },
    ]);

    const result = await detectOverlaps({
      workspaceSlug: "rise",
      candidatePersonIds: ["p1"],
    });
    expect(result.length).toBe(1);
  });
});
