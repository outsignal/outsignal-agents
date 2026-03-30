import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    pipelineCostLog: {
      create: vi.fn(),
      groupBy: vi.fn(),
    },
    campaign: {
      findUnique: vi.fn(),
    },
    targetListPerson: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { logPipelineCost, getCampaignCostBreakdown } from "@/lib/campaigns/cost-tracking";

const mockCreate = (prisma.pipelineCostLog as unknown as Record<string, ReturnType<typeof vi.fn>>).create;
const mockGroupBy = (prisma.pipelineCostLog as unknown as Record<string, ReturnType<typeof vi.fn>>).groupBy;
const mockCampaignFindUnique = prisma.campaign.findUnique as ReturnType<typeof vi.fn>;
const mockTlpCount = prisma.targetListPerson.count as ReturnType<typeof vi.fn>;

describe("logPipelineCost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a PipelineCostLog entry", async () => {
    mockCreate.mockResolvedValue({ id: "log-1" });

    await logPipelineCost({
      campaignId: "c1",
      workspaceSlug: "rise",
      stage: "discovery",
      provider: "apollo-search",
      costUsd: 0.05,
      itemCount: 25,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        campaignId: "c1",
        workspaceSlug: "rise",
        stage: "discovery",
        provider: "apollo-search",
        costUsd: 0.05,
        itemCount: 25,
      },
    });
  });

  it("sets campaignId to null when not provided", async () => {
    mockCreate.mockResolvedValue({ id: "log-2" });

    await logPipelineCost({
      workspaceSlug: "rise",
      stage: "enrichment",
      provider: "prospeo",
      costUsd: 0.10,
      itemCount: 50,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: null,
      }),
    });
  });
});

describe("getCampaignCostBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates costs by stage and returns discovery, enrichment, verification totals", async () => {
    mockGroupBy.mockResolvedValue([
      { stage: "discovery", _sum: { costUsd: 1.50 } },
      { stage: "enrichment", _sum: { costUsd: 3.00 } },
      { stage: "verification", _sum: { costUsd: 0.50 } },
    ]);
    mockCampaignFindUnique.mockResolvedValue({ targetListId: "tl-1" });
    mockTlpCount.mockResolvedValue(100);

    const result = await getCampaignCostBreakdown("c1");

    expect(result.discovery).toBe(1.50);
    expect(result.enrichment).toBe(3.00);
    expect(result.verification).toBe(0.50);
    expect(result.total).toBe(5.00);
    expect(result.leadCount).toBe(100);
    expect(result.costPerLead).toBe(0.05);
  });

  it("returns costPerLead as null when leadCount is 0", async () => {
    mockGroupBy.mockResolvedValue([
      { stage: "discovery", _sum: { costUsd: 2.00 } },
    ]);
    mockCampaignFindUnique.mockResolvedValue({ targetListId: "tl-1" });
    mockTlpCount.mockResolvedValue(0);

    const result = await getCampaignCostBreakdown("c1");

    expect(result.costPerLead).toBeNull();
    expect(result.leadCount).toBe(0);
  });

  it("returns zeros when no cost logs exist", async () => {
    mockGroupBy.mockResolvedValue([]);
    mockCampaignFindUnique.mockResolvedValue({ targetListId: null });

    const result = await getCampaignCostBreakdown("c1");

    expect(result.discovery).toBe(0);
    expect(result.enrichment).toBe(0);
    expect(result.verification).toBe(0);
    expect(result.total).toBe(0);
    expect(result.leadCount).toBe(0);
    expect(result.costPerLead).toBeNull();
  });
});
