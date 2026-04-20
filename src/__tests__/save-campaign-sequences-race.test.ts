import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  campaign: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (innerTx: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  },
}));

import { saveCampaignSequences } from "@/lib/campaigns/operations";

const mockFindUnique = tx.campaign.findUnique as ReturnType<typeof vi.fn>;
const mockUpdateMany = tx.campaign.updateMany as ReturnType<typeof vi.fn>;

const CAMPAIGN_ID = "camp-race-1";
const UPDATED_AT = new Date("2026-04-18T10:00:00.000Z");

function fakeRawCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    name: "Race Campaign",
    workspaceSlug: "test-ws",
    type: "static",
    status: "pending_approval",
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
    createdAt: new Date(),
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

describe("saveCampaignSequences optimistic concurrency guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates with an updatedAt compare-and-swap and refetches the row", async () => {
    mockFindUnique
      .mockResolvedValueOnce({
        workspaceSlug: "test-ws",
        name: "Race Campaign",
        status: "pending_approval",
        updatedAt: UPDATED_AT,
        contentApproved: true,
        emailSequence: JSON.stringify([
          { position: 1, subjectLine: "old", body: "old", delayDays: 0 },
        ]),
        linkedinSequence: null,
      })
      .mockResolvedValueOnce(
        fakeRawCampaign({
          contentApproved: false,
          contentApprovedAt: null,
          emailSequence: JSON.stringify([
            { position: 1, subjectLine: "new", body: "new", delayDays: 0 },
          ]),
        }),
      );
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const result = await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: [
        { position: 1, subjectLine: "new", body: "new", delayDays: 0 },
      ],
    });

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID, updatedAt: UPDATED_AT },
      data: expect.objectContaining({
        emailSequence: JSON.stringify([
          { position: 1, subjectLine: "new", body: "new", delayDays: 0 },
        ]),
        contentApproved: false,
        contentApprovedAt: null,
      }),
    });
    expect(
      (result.emailSequence?.[0] as { subjectLine?: string } | undefined)
        ?.subjectLine,
    ).toBe("new");
  });

  it("throws a retryable conflict when another write wins before the CAS update", async () => {
    mockFindUnique.mockResolvedValueOnce({
      workspaceSlug: "test-ws",
      name: "Race Campaign",
      status: "approved",
      updatedAt: UPDATED_AT,
      contentApproved: true,
      emailSequence: JSON.stringify([
        { position: 1, subjectLine: "old", body: "old", delayDays: 0 },
      ]),
      linkedinSequence: null,
    });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      saveCampaignSequences(CAMPAIGN_ID, {
        emailSequence: [
          { position: 1, subjectLine: "new", body: "new", delayDays: 0 },
        ],
      }),
    ).rejects.toThrow(/modified concurrently/i);
  });
});
