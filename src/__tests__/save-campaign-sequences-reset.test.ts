/**
 * BL-053 — saveCampaignSequences contentApproved reset guard.
 *
 * Spec: when persisting a sequence that OVERWRITES an existing sequence on a
 * campaign where contentApproved=true, the save path must flip contentApproved
 * back to false, clear contentApprovedAt, and write an AuditLog row. If the
 * campaign had reached status=approved via dual approval, the save must also
 * flip the status back to pending_approval. A first-time sequence save must
 * NOT trigger the reset (campaign was never approved against prior copy). An
 * idempotent save (same content re-submitted) must NOT trigger the reset.
 * leadsApproved is deferred — not touched by this fix.
 *
 * Transaction safety: distinct outer `prisma` and inner `tx` mocks verify
 * that reads/writes inside the callback route through the tx client, not the
 * outer prisma client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Distinct outer prisma + inner tx mocks. The $transaction mock invokes the
// callback with the tx client; tests assert that save reads/writes hit the
// tx client and NOT the outer prisma client. This catches regressions where
// a future refactor accidentally reaches for the outer client and loses
// transactional atomicity.
vi.mock("@/lib/db", async () => {
  const tx = {
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };

  const prismaMock = {
    // Outer-client stubs that should NEVER be called during saveCampaignSequences.
    // If a test ever asserts one of these was called, the implementation has
    // bypassed the transaction.
    campaign: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn(tx);
    }),
    // Expose the inner tx for test assertions.
    __tx: tx,
  };

  return { prisma: prismaMock };
});

import { prisma } from "@/lib/db";
import { saveCampaignSequences } from "@/lib/campaigns/operations";
import { SYSTEM_ADMIN_EMAIL } from "@/lib/audit";

/* eslint-disable @typescript-eslint/no-explicit-any */
const prismaAny = prisma as any;
const tx = prismaAny.__tx;

const mockFindUnique = tx.campaign.findUnique as ReturnType<typeof vi.fn>;
const mockUpdate = tx.campaign.update as ReturnType<typeof vi.fn>;
const mockAuditCreate = tx.auditLog.create as ReturnType<typeof vi.fn>;
const mockTransaction = prismaAny.$transaction as ReturnType<typeof vi.fn>;

// Outer-client sentinels — these must never be hit.
const outerFindUnique = prismaAny.campaign.findUnique as ReturnType<typeof vi.fn>;
const outerUpdate = prismaAny.campaign.update as ReturnType<typeof vi.fn>;
const outerAuditCreate = prismaAny.auditLog.create as ReturnType<typeof vi.fn>;
/* eslint-enable @typescript-eslint/no-explicit-any */

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
    approvedContentHash: null,
    approvedContentSnapshot: null,
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
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
      contentApproved: true,
      contentApprovedAt: new Date("2026-04-20T00:00:00.000Z"),
      approvedContentHash: "hash-123",
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

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: CAMPAIGN_ID });
    expect(updateArgs.data.contentApproved).toBe(false);
    expect(updateArgs.data.contentApprovedAt).toBeNull();
    expect(updateArgs.data.approvedContentHash).toBeNull();
    expect(updateArgs.data.approvedContentSnapshot).toBeNull();
    // status was pending_approval, not approved → no status flip needed
    expect(updateArgs.data).not.toHaveProperty("status");
    // leadsApproved must NOT be touched (deferred per BL-053 scope).
    expect(updateArgs.data).not.toHaveProperty("leadsApproved");
    expect(updateArgs.data).not.toHaveProperty("leadsApprovedAt");

    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = mockAuditCreate.mock.calls[0][0];
    expect(auditArgs.data.action).toBe("campaign.contentApproved.reset");
    expect(auditArgs.data.entityType).toBe("Campaign");
    expect(auditArgs.data.entityId).toBe(CAMPAIGN_ID);
    expect(auditArgs.data.adminEmail).toBe(SYSTEM_ADMIN_EMAIL);
    expect(auditArgs.data.metadata.reason).toBe("sequence overwritten");
    expect(auditArgs.data.metadata.workspace).toBe("test-ws");
    expect(auditArgs.data.metadata.campaignName).toBe("Test Campaign");
    expect(auditArgs.data.metadata.previousContentApproved).toBe(true);
    expect(auditArgs.data.metadata.newContentApproved).toBe(false);
    expect(auditArgs.data.metadata.previousStatus).toBe("pending_approval");
    expect(auditArgs.data.metadata.newStatus).toBe("pending_approval");
    expect(auditArgs.data.metadata.emailOverwritten).toBe(true);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("Finding 1: status=approved + content rewrite flips status to pending_approval (1210 bug)", async () => {
    // This is the actual bug that stranded 1210 Healthcare: campaign at
    // status=approved + contentApproved=true + leadsApproved=true, Nova
    // Writer rewrote the sequence, approval flags should have flipped
    // but status stayed on 'approved' holding unapproved content.
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "1210 Healthcare",
      status: "approved",
      contentApproved: true,
      contentApprovedAt: new Date("2026-04-20T00:00:00.000Z"),
      approvedContentHash: "hash-1210",
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        name: "1210 Healthcare",
        status: "pending_approval",
        emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
        contentApproved: false,
        contentApprovedAt: null,
        leadsApproved: true,
      }),
    );
    mockAuditCreate.mockResolvedValue({ id: "audit_1210" });

    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: [
        { position: 1, subjectLine: "rewritten", body: "new body", delayDays: 0 },
      ],
    });

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.contentApproved).toBe(false);
    expect(updateArgs.data.contentApprovedAt).toBeNull();
    expect(updateArgs.data.approvedContentHash).toBeNull();
    expect(updateArgs.data.approvedContentSnapshot).toBeNull();
    // THE FIX: status must flip back to pending_approval.
    expect(updateArgs.data.status).toBe("pending_approval");
    // leadsApproved stays — sequence rewrite doesn't invalidate the lead list.
    expect(updateArgs.data).not.toHaveProperty("leadsApproved");

    // Audit log captures the status transition for debugging.
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = mockAuditCreate.mock.calls[0][0];
    expect(auditArgs.data.metadata.previousStatus).toBe("approved");
    expect(auditArgs.data.metadata.newStatus).toBe("pending_approval");
  });

  it("Test B: first sequence save on an (unapproved) campaign does NOT reset or audit", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
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
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(updateArgs.data).not.toHaveProperty("contentApprovedAt");
    expect(updateArgs.data).not.toHaveProperty("status");
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("Test C: overwriting a sequence when contentApproved=false does NOT reset or audit", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
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

  it("no prior sequence on any channel + contentApproved=true: first save of LinkedIn does not reset", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
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
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("overwriting LinkedIn on an approved campaign that had a prior LinkedIn sequence triggers reset", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
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

  it("rejects zero-based email sequence positions so new drift cannot be persisted", async () => {
    await expect(
      saveCampaignSequences(CAMPAIGN_ID, {
        emailSequence: [
          { position: 0, subjectLine: "step 1", body: "body 1", delayDays: 0 },
          { position: 1, subjectLine: "step 2", body: "body 2", delayDays: 3 },
          { position: 2, subjectLine: "step 3", body: "body 3", delayDays: 7 },
        ],
      }),
    ).rejects.toThrow(/emailSequence positions must be canonical 1-indexed steps/);

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Finding 3: copyStrategy-only saves are metadata, must NOT reset
  // ---------------------------------------------------------------------------

  it("Finding 3a: copyStrategy-only save on approved campaign does NOT reset", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "approved",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        status: "approved",
        emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
        contentApproved: true,
        copyStrategy: "pvp",
      }),
    );

    await saveCampaignSequences(CAMPAIGN_ID, { copyStrategy: "pvp" });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.copyStrategy).toBe("pvp");
    // Metadata change must NOT reset approval or status.
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(updateArgs.data).not.toHaveProperty("contentApprovedAt");
    expect(updateArgs.data).not.toHaveProperty("status");
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("Finding 3b: combined {emailSequence, copyStrategy} with changed sequence DOES reset", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
        contentApproved: false,
        contentApprovedAt: null,
        copyStrategy: "creative-ideas",
      }),
    );
    mockAuditCreate.mockResolvedValue({ id: "audit_3b" });

    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: [
        { position: 1, subjectLine: "changed", body: "changed body", delayDays: 0 },
      ],
      copyStrategy: "creative-ideas",
    });

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.copyStrategy).toBe("creative-ideas");
    expect(updateArgs.data.contentApproved).toBe(false);
    expect(updateArgs.data.contentApprovedAt).toBeNull();
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Finding 4: idempotent saves must NOT spuriously reset
  // ---------------------------------------------------------------------------

  it("Finding 4: saving identical sequence content twice does NOT reset on second save", async () => {
    // Simulate UI retry / idempotent client call: the payload matches what
    // is already in the DB. Expected: no-op. No reset, no audit row.
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "approved",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        status: "approved",
        emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
        contentApproved: true,
      }),
    );

    // Re-submit the EXACT same sequence content.
    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: SAMPLE_EMAIL_SEQUENCE,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    // Update still fires (emailSequence is set) but reset flags do NOT.
    expect(updateArgs.data.emailSequence).toBe(JSON.stringify(SAMPLE_EMAIL_SEQUENCE));
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(updateArgs.data).not.toHaveProperty("contentApprovedAt");
    expect(updateArgs.data).not.toHaveProperty("status");
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Finding 6: empty-sequence-clear loophole
  // ---------------------------------------------------------------------------

  it("Finding 6a: clearing a populated sequence on approved campaign triggers reset", async () => {
    // Prior had content, new is []. That IS a content change (a clear).
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        emailSequence: JSON.stringify([]),
        contentApproved: false,
        contentApprovedAt: null,
      }),
    );
    mockAuditCreate.mockResolvedValue({ id: "audit_6a" });

    await saveCampaignSequences(CAMPAIGN_ID, { emailSequence: [] });

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data.contentApproved).toBe(false);
    expect(updateArgs.data.contentApprovedAt).toBeNull();
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditCreate.mock.calls[0][0].data.metadata.emailOverwritten).toBe(true);
  });

  it("Finding 6b: clearing an already-empty sequence does NOT re-fire reset", async () => {
    // Prior was [], new is []. sequencesEqual returns true → no-op.
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
      contentApproved: true,
      emailSequence: JSON.stringify([]),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        emailSequence: JSON.stringify([]),
        contentApproved: true,
      }),
    );

    await saveCampaignSequences(CAMPAIGN_ID, { emailSequence: [] });

    const updateArgs = mockUpdate.mock.calls[0][0];
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Finding 2: transaction isolation — outer prisma client must never be used
  // ---------------------------------------------------------------------------

  it("Finding 2: reads and writes route through tx client, never the outer prisma client", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
        contentApproved: false,
      }),
    );
    mockAuditCreate.mockResolvedValue({ id: "audit_iso" });

    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: [
        { position: 1, subjectLine: "new", body: "new body", delayDays: 0 },
      ],
    });

    // Inner tx client received the reads + writes.
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);

    // Outer prisma client must NOT have been used.
    expect(outerFindUnique).not.toHaveBeenCalled();
    expect(outerUpdate).not.toHaveBeenCalled();
    expect(outerAuditCreate).not.toHaveBeenCalled();

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("Finding 2b: audit write failure propagates the error", async () => {
    // If tx.auditLog.create rejects, the $transaction callback rejects, and
    // the whole operation must throw. This test proves ERROR PROPAGATION
    // only — NOT rollback. True atomicity (both writes undone on the DB)
    // depends on real Prisma's $transaction semantics and would require
    // an integration test against a real database.
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({ emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE) }),
    );
    mockAuditCreate.mockRejectedValue(new Error("boom"));

    await expect(
      saveCampaignSequences(CAMPAIGN_ID, {
        emailSequence: [
          { position: 1, subjectLine: "new", body: "new body", delayDays: 0 },
        ],
      }),
    ).rejects.toThrow(/boom/);
  });

  // ---------------------------------------------------------------------------
  // Finding A: deployed/active/paused/completed campaigns reject overwrites
  // ---------------------------------------------------------------------------

  it("Finding A1: overwriting a deployed campaign's sequence throws and writes no state", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Deployed Campaign",
      status: "deployed",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });

    await expect(
      saveCampaignSequences(CAMPAIGN_ID, {
        emailSequence: [
          { position: 1, subjectLine: "rewritten", body: "new body", delayDays: 0 },
        ],
      }),
    ).rejects.toThrow(/Cannot overwrite sequence.*status="deployed"/);

    // No state changes — the throw must fire before any writes.
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("Finding A2: overwriting an active campaign's sequence throws", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Active Campaign",
      status: "active",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });

    await expect(
      saveCampaignSequences(CAMPAIGN_ID, {
        emailSequence: [
          { position: 1, subjectLine: "rewritten", body: "new body", delayDays: 0 },
        ],
      }),
    ).rejects.toThrow(/status="active"/);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("Finding A3: overwriting a paused campaign's sequence throws", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Paused Campaign",
      status: "paused",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });

    await expect(
      saveCampaignSequences(CAMPAIGN_ID, {
        emailSequence: [
          { position: 1, subjectLine: "rewritten", body: "new body", delayDays: 0 },
        ],
      }),
    ).rejects.toThrow(/status="paused"/);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("Finding A4: overwriting a completed campaign's sequence throws", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Completed Campaign",
      status: "completed",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });

    await expect(
      saveCampaignSequences(CAMPAIGN_ID, {
        emailSequence: [
          { position: 1, subjectLine: "rewritten", body: "new body", delayDays: 0 },
        ],
      }),
    ).rejects.toThrow(/status="completed"/);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it("Finding A5: IDENTICAL content save on a deployed campaign succeeds (pure no-op)", async () => {
    // Prior content matches the new content exactly → not an overwrite →
    // no reset required → no status-guard violation. Should succeed.
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Deployed Campaign",
      status: "deployed",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        status: "deployed",
        emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
        contentApproved: true,
      }),
    );

    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: SAMPLE_EMAIL_SEQUENCE,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    // No reset flags — this is an idempotent save.
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(updateArgs.data).not.toHaveProperty("contentApprovedAt");
    expect(updateArgs.data).not.toHaveProperty("status");
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Finding B: sequencesEqual is key-order-insensitive (via canonicalize)
  // ---------------------------------------------------------------------------

  it("Finding B: reordered object keys in the new sequence are treated as equal (no reset)", async () => {
    // Prior sequence has keys in order [position, body, subject].
    // New sequence has keys in order [subject, body, position].
    // Canonicalize() sorts keys before stringify → these compare equal.
    const priorStep = { position: 1, body: "hi", subject: "test" };
    const newStep = { subject: "test", body: "hi", position: 1 };

    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "approved",
      contentApproved: true,
      emailSequence: JSON.stringify([priorStep]),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        status: "approved",
        emailSequence: JSON.stringify([priorStep]),
        contentApproved: true,
      }),
    );

    await saveCampaignSequences(CAMPAIGN_ID, { emailSequence: [newStep] });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = mockUpdate.mock.calls[0][0];
    // No overwrite detected, no reset.
    expect(updateArgs.data).not.toHaveProperty("contentApproved");
    expect(updateArgs.data).not.toHaveProperty("contentApprovedAt");
    expect(updateArgs.data).not.toHaveProperty("status");
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Finding E: audit metadata includes statusChanged boolean
  // ---------------------------------------------------------------------------

  it("Finding E1: audit metadata includes statusChanged=false when no status transition", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "pending_approval",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
        contentApproved: false,
      }),
    );
    mockAuditCreate.mockResolvedValue({ id: "audit_e1" });

    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: [
        { position: 1, subjectLine: "rewritten", body: "new body", delayDays: 0 },
      ],
    });

    const auditArgs = mockAuditCreate.mock.calls[0][0];
    expect(auditArgs.data.metadata.previousStatus).toBe("pending_approval");
    expect(auditArgs.data.metadata.newStatus).toBe("pending_approval");
    expect(auditArgs.data.metadata.statusChanged).toBe(false);
  });

  it("Finding E2: audit metadata includes statusChanged=true when approved → pending_approval", async () => {
    mockFindUnique.mockResolvedValue({
      workspaceSlug: "test-ws",
      name: "Test Campaign",
      status: "approved",
      contentApproved: true,
      emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
      linkedinSequence: null,
    });
    mockUpdate.mockResolvedValue(
      fakeRawCampaign({
        status: "pending_approval",
        emailSequence: JSON.stringify(SAMPLE_EMAIL_SEQUENCE),
        contentApproved: false,
      }),
    );
    mockAuditCreate.mockResolvedValue({ id: "audit_e2" });

    await saveCampaignSequences(CAMPAIGN_ID, {
      emailSequence: [
        { position: 1, subjectLine: "rewritten", body: "new body", delayDays: 0 },
      ],
    });

    const auditArgs = mockAuditCreate.mock.calls[0][0];
    expect(auditArgs.data.metadata.previousStatus).toBe("approved");
    expect(auditArgs.data.metadata.newStatus).toBe("pending_approval");
    expect(auditArgs.data.metadata.statusChanged).toBe(true);
  });
});
