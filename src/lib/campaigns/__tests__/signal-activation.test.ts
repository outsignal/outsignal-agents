import { beforeEach, describe, expect, it, vi } from "vitest";

const { campaignMock } = vi.hoisted(() => ({
  campaignMock: {
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: campaignMock,
  },
}));

import {
  claimSignalCampaignActivation,
  finalizeSignalCampaignActivation,
  rollbackSignalCampaignActivationClaim,
} from "@/lib/campaigns/signal-activation";

const CAMPAIGN_ID = "signal-camp-1";
const CLAIMED_AT = new Date("2026-04-18T17:10:00.000Z");

describe("signal activation claim helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims activation only from draft campaigns with no prior claim token", async () => {
    campaignMock.updateMany.mockResolvedValue({ count: 1 });

    const claimed = await claimSignalCampaignActivation(CAMPAIGN_ID, CLAIMED_AT);

    expect(claimed).toBe(true);
    expect(campaignMock.updateMany).toHaveBeenCalledWith({
      where: {
        id: CAMPAIGN_ID,
        status: "draft",
        lastSignalProcessedAt: null,
      },
      data: {
        lastSignalProcessedAt: CLAIMED_AT,
      },
    });
  });

  it("returns false when another request already claimed activation", async () => {
    campaignMock.updateMany.mockResolvedValue({ count: 0 });

    const claimed = await claimSignalCampaignActivation(CAMPAIGN_ID, CLAIMED_AT);

    expect(claimed).toBe(false);
  });

  it("finalizes the claimed draft campaign into active state", async () => {
    campaignMock.updateMany.mockResolvedValue({ count: 1 });

    const finalized = await finalizeSignalCampaignActivation({
      campaignId: CAMPAIGN_ID,
      claimedAt: CLAIMED_AT,
      targetListId: "tl-1",
      signalEmailBisonCampaignId: 12345,
    });

    expect(finalized).toBe(true);
    expect(campaignMock.updateMany).toHaveBeenCalledWith({
      where: {
        id: CAMPAIGN_ID,
        status: "draft",
        lastSignalProcessedAt: CLAIMED_AT,
      },
      data: {
        status: "active",
        targetListId: "tl-1",
        signalEmailBisonCampaignId: 12345,
        lastSignalProcessedAt: CLAIMED_AT,
      },
    });
  });

  it("surfaces a descriptive error on unique signalEmailBisonCampaignId collisions", async () => {
    campaignMock.updateMany.mockRejectedValue({
      code: "P2002",
      meta: { target: ["signalEmailBisonCampaignId"] },
    });

    await expect(
      finalizeSignalCampaignActivation({
        campaignId: CAMPAIGN_ID,
        claimedAt: CLAIMED_AT,
        signalEmailBisonCampaignId: 12345,
      }),
    ).rejects.toThrow(/already linked to another signal campaign/i);
  });

  it("rolls back only the matching activation claim token", async () => {
    campaignMock.updateMany.mockResolvedValue({ count: 1 });

    await rollbackSignalCampaignActivationClaim(CAMPAIGN_ID, CLAIMED_AT);

    expect(campaignMock.updateMany).toHaveBeenCalledWith({
      where: {
        id: CAMPAIGN_ID,
        status: "draft",
        lastSignalProcessedAt: CLAIMED_AT,
      },
      data: {
        lastSignalProcessedAt: null,
      },
    });
  });
});
