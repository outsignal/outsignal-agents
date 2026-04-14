/**
 * BL-053 — saveCampaignSequences contentApproved reset guard.
 *
 * Spec: when persisting a sequence that OVERWRITES an existing sequence on a
 * campaign where contentApproved=true, the save path must flip contentApproved
 * back to false, clear contentApprovedAt, and write an AuditLog row. A
 * first-time sequence save must NOT trigger the reset (campaign was never
 * approved against prior copy). leadsApproved is deferred — not touched by
 * this fix.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Extend the shared mock with auditLog + $transaction support for this test.
// The shared setup.ts mock stubs `prisma.campaign.findUnique/update` which is
// all we need via a transaction that simply runs the callback against the
// same mocked prisma client.
vi.mock("@/lib/db", async () => {
  const campaignFindUnique = vi.fn();
  const campaignUpdate = vi.fn();
  const auditLogCreate = vi.fn();

  const prismaMock = {
    campaign: {
      findUnique: campaignFindUnique,
      update: campaignUpdate,
    },
    auditLog: {
      create: auditLogCreate,
    },
    // $transaction invokes the callback with the same mock client so the
    // transactional reads/writes route to the same vi.fn() mocks the tests
    // configure below.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn(prismaMock);
    }),
  };

  return { prisma: prismaMock };
});

import { prisma } from "@/lib/db";
import { saveCampaignSequences } from "@/lib/campaigns/operations";

const mockFindUnique = prisma.campaign.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.campaign.update as ReturnType<typeof vi.fn>;
const mockAuditCreate = prisma.auditLog.create as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTransaction = (prisma as any).$transaction as ReturnType<typeof vi.fn>;

const CAMPAIGN_ID = "camp_test_1";

/** Build a fake raw Campaign row that satisfies formatCampaignDetail. */
function fakeRawCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_ID,
    name: "Test Campaign",
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
    updatedAt: new Date(),
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

const SAMPLE_EMAIL_SEQUENCE = [
  {
    position: 1,
    subjectLine: "hello",
    body: "first email body",
    delayDays: 0,
  },
];

const SAMPLE_LINKEDIN_SEQUENCE = [
  {
    position: 1,
    type: "connection_request",
    body: "hi there",
    delayDays: 0,
  },
];

describe("saveCampaignSequences — contentApproved reset (BL-053)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test A: overwriting an approved campaign's sequence resets contentApproved + writes AuditLog", async () => {
    // Campaign currently has an existing email sequence AND contentApproved=true.
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
        contentApproved: false,
        contentApprovedAt: null,
      }),
    );
    mockAuditCreate.mockResolvedValue({ id: "audit_1" });

    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: [
        { position: 1, subjectLine: "rewritten", body: "new body", delayDays: 0 },
      ],
    });

    // Update should include contentApproved reset flags.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: CAMPAIGN_ID });
    expect(updateArgs.data.contentApproved).toBe(false);
    expect(updateArgs.data.contentApprovedAt).toBeNull();
    // leadsApproved must NOT be touched (deferred per BL-053 scope).
    expect(updateArgs.data).not.toHaveProperty("leadsApproved");
    expect(updateArgs.data).not.toHaveProperty("leadsApprovedAt");

    // AuditLog row must be written with correct action/reason.
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = mockAuditCreate.mock.calls[0][0];
    expect(auditArgs.data.action).toBe("campaign.contentApproved.reset");
    expect(auditArgs.data.entityType).toBe("Campaign");
    expect(auditArgs.data.entityId).toBe(CAMPAIGN_ID);
    expect(auditArgs.data.metadata.reason).toBe("sequence overwritten");
    expect(auditArgs.data.metadata.workspace).toBe("test-ws");
    expect(auditArgs.data.metadata.campaignName).toBe("Test Campaign");
    expect(auditArgs.data.metadata.previousContentApproved).toBe(true);
    expect(auditArgs.data.metadata.newContentApproved).toBe(false);
    expect(auditArgs.data.metadata.emailOverwritten).toBe(true);

    // The whole thing runs in a transaction.
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("Test B: first sequence save on an (unapproved) campaign does NOT reset or audit", async () => {
    // No prior sequence → first save. contentApproved=false (never approved).
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      contentApproved: false,
      emailSequence: null,
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({ emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE) }),
    );

    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: SAMPLE_EMAIL_SEQUENCE,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    // No reset flags should be set — this is a first-time save.
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(updateArgs.data).not.toHaveProperty("contentApprovedAt");

    // No audit row.
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("Test C: overwriting a sequence when contentApproved=false does NOT reset or audit", async () => {
    // Prior sequence exists, but campaign was never approved.
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      contentApproved: false,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({ emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE) }),
    );

    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: [
        { position: 1, subjectLine: "v2", body: "v2 body", delayDays: 0 },
      ],
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(updateArgs.data).not.toHaveProperty("contentApprovedAt");
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("saving LinkedIn sequence when only email was approved+existing still triggers reset (LinkedIn overwrite of empty is a first save, but email approval flag applies to the whole campaign) — specifically: if NEITHER channel is an overwrite, no reset", async () => {
    // contentApproved=true, but no prior sequences of any kind. Edge case:
    // contentApproved should never be true without sequences in practice,
    // but if it is, we treat a first-save as a non-overwrite and skip reset.
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      contentApproved: true,
      emailSequence: null,
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        linkedinSequence: JSON.stringify(SAMPLE_LINKEDIN_SEQUENCE),
        contentApproved: true,
      }),
    );

    await saveCampaignSequences(CAMPAIGN_ID, {
      linkedinSequence: SAMPLE_LINKEDIN_SEQUENCE,
    });

    const updateArgs = mockUpdate.mock.calls[0][0];
    // No prior sequence on any channel → not an overwrite → no reset.
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("overwriting LinkedIn on an approved campaign that had a prior LinkedIn sequence triggers reset", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      contentApproved: true,
      emailSequence: null,
      linkedinSequence: JSON.stringify(SAMPLE_LINKEDIN_SEQUENCE),
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        linkedinSequence: JSON.stringify(SAMPLE_LINKEDIN_SEQUENCE),
        contentApproved: false,
        contentApprovedAt: null,
      }),
    );
    mockAuditCreate.mockResolvedValue({ id: "audit_2" });

    await saveCampaignSequences(CAMPAIGN_ID, {
      linkedinSequence: [
        { position: 1, type: "message", body: "new", delayDays: 0 },
      ],
    });

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.contentApproved).toBe(false);
    expect(updateArgs.data.contentApprovedAt).toBeNull();
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = mockAuditCreate.mock.calls[0][0];
    expect(auditArgs.data.metadata.linkedinOverwritten).toBe(true);
    expect(auditArgs.data.metadata.emailOverwritten).toBe(false);
  });

  it("throws if campaign does not exist", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(
      saveCampaignSequences("nonexistent", {
        emailSequence: SAMPLE_EMAIL_SEQUENCE,
      }),
    ).rejects.toThrow(/Campaign not found/);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });
});
