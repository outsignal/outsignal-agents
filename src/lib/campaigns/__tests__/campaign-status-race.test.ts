import { beforeEach, describe, expect, it, vi } from "vitest";

const { txCampaign } = vi.hoisted(() => ({
  txCampaign: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: txCampaign,
  },
}));

import { updateCampaignStatus } from "@/lib/campaigns/operations";

const CAMPAIGN_ID = "camp-status-race-1";
const UPDATED_AT = new Date("2026-04-18T10:00:00.000Z");

function fakeRawCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    name: "Race Campaign",
    workspaceSlug: "test-ws",
    type: "static",
    status: "active",
    channels: JSON.stringify(["email"]),
    description: null,
    emailSequence: null,
    linkedinSequence: null,
    copyStrategy: null,
    targetListId: null,
    leadsApproved: false,
    leadsFeedback: null,
    leadsApprovedAt: null,
    contentApproved: false,
    contentFeedback: null,
    contentApprovedAt: null,
    emailBisonCampaignId: null,
    publishedAt: null,
    deployedAt: null,
    createdAt: new Date("2026-04-01T10:00:00.000Z"),
    updatedAt: UPDATED_AT,
    icpCriteria: null,
    signalTypes: null,
    dailyLeadCap: 50,
    icpScoreThreshold: 60,
    signalEmailBisonCampaignId: null,
    lastSignalProcessedAt: null,
    targetList: null,
    ...overrides,
  };
}

describe("updateCampaignStatus optimistic concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compares on the originally read status before applying the transition", async () => {
    txCampaign.findUnique
      .mockResolvedValueOnce({ status: "deployed", type: "static" })
      .mockResolvedValueOnce(fakeRawCampaign({ status: "active" }));
    txCampaign.updateMany.mockResolvedValue({ count: 1 });

    const result = await updateCampaignStatus(CAMPAIGN_ID, "active");

    expect(txCampaign.updateMany).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID, status: "deployed" },
      data: { status: "active" },
    });
    expect(result.status).toBe("active");
  });

  it("throws a retryable conflict when another write changes status first", async () => {
    txCampaign.findUnique
      .mockResolvedValueOnce({ status: "deployed", type: "static" })
      .mockResolvedValueOnce({ status: "paused" });
    txCampaign.updateMany.mockResolvedValue({ count: 0 });

    await expect(updateCampaignStatus(CAMPAIGN_ID, "active")).rejects.toThrow(
      /modified concurrently/i,
    );
  });
});
