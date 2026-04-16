/**
 * BL-075 (Phase 6.5b Bundle B) — executeDeploy atomic Campaign rollback tests.
 *
 * Context: `initiateCampaignDeploy` flips Campaign.status approved→deployed
 * optimistically (deploy-campaign.ts:130-133) and the adapter persists
 * Campaign.emailBisonCampaignId mid-deploy. Before this bundle, a terminal
 * failure in `executeDeploy` only flipped CampaignDeploy.status to 'failed' —
 * Campaign was left in a zombie state (status='deployed', deployedAt set,
 * emailBisonCampaignId set) that looked successful. Commit 184db22c was a
 * one-shot SQL cleanup for exactly this drift.
 *
 * This suite covers the systemic fix at src/lib/campaigns/deploy.ts's outer
 * catch — the atomic $transaction that rolls Campaign.status back to
 * 'approved', clears emailBisonCampaignId + deployedAt, writes the terminal
 * CampaignDeploy.status='failed' row, and writes an AuditLog describing the
 * rollback. Plus the retry-awareness gate that SKIPS the Campaign rollback
 * when another CampaignDeploy row for the same campaignId is still in flight.
 *
 * Cases:
 *   1. Happy path — deploy succeeds. No rollback, no audit row.
 *   2. Terminal failure, no inflight sibling — full rollback + audit.
 *   3. Terminal failure WITH inflight sibling — CampaignDeploy flipped to
 *      failed but Campaign UNTOUCHED, NO audit row.
 *   4. AuditLog metadata shape — verify action name, all required keys,
 *      reason clip at 500 chars, clearedEmailBisonCampaignId matches snapshot.
 *   5. Edge case — Campaign already moved off 'deployed' (e.g. manually
 *      paused mid-deploy): rollback updateMany count=0, NO audit row,
 *      CampaignDeploy still flipped.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting — prisma (outer + inner tx), adapters, getCampaign,
// notifications. Mirrors the pattern from save-campaign-sequences-reset.test.ts
// (distinct outer + tx clients so tests can assert reads/writes land inside
// the transaction, not on the outer client) and from email-adapter-race.test.ts
// (vi.hoisted with prisma/getCampaign mocks).
// ---------------------------------------------------------------------------

const { txMock, prismaMock, getCampaignMock, adapterDeployMock } = vi.hoisted(() => {
  const tx = {
    campaignDeploy: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    campaign: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  };
  return {
    txMock: tx,
    prismaMock: {
      // Outer-client writes — status→running on entry, skipped-channel
      // writes, finalize reads. All pre-catch paths land here.
      campaignDeploy: {
        update: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      campaign: {
        updateMany: vi.fn(),
      },
      // $transaction invokes the callback with the tx client — any read or
      // write inside the rollback MUST hit `tx` not the outer client.
      $transaction: vi.fn(
        async (fn: (txArg: unknown) => Promise<unknown>) => fn(tx),
      ),
    },
    getCampaignMock: vi.fn(),
    adapterDeployMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (...args: unknown[]) => getCampaignMock(...args),
}));

// Stub adapter registry — initAdapters is a no-op; getAdapter returns a fake
// adapter whose deploy() call is driven per-test (success or throw).
vi.mock("@/lib/channels", () => ({
  initAdapters: vi.fn(),
  getAdapter: () => ({ deploy: adapterDeployMock }),
}));

// Stub notifications — we don't assert on them. Fire-and-forget suppresses any
// unhandled-promise noise.
vi.mock("@/lib/notifications", () => ({
  notifyDeploy: vi.fn().mockResolvedValue(undefined),
  notifyCampaignLive: vi.fn().mockResolvedValue(undefined),
}));

import { executeDeploy } from "@/lib/campaigns/deploy";
import { SYSTEM_ADMIN_EMAIL } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = "camp_rollback_1";
const DEPLOY_ID = "deploy_rollback_1";

function seedHappyCampaign() {
  // `getCampaign` returns a CampaignDetail shape — only the fields executeDeploy
  // reads (status, channels, name, workspaceSlug) are relevant here.
  getCampaignMock.mockResolvedValue({
    id: CAMPAIGN_ID,
    name: "Rollback Test Campaign",
    workspaceSlug: "test-ws",
    status: "deployed",
    channels: ["email"],
  });
}

function seedPostDeploySnapshot(opts: {
  finalDeployStatus?: string;
  emailStatus?: string;
} = {}) {
  const { finalDeployStatus = "complete", emailStatus = "complete" } = opts;

  // finalizeDeployStatus reads these, plus the post-finalize checks.
  prismaMock.campaignDeploy.findUniqueOrThrow.mockResolvedValue({
    status: finalDeployStatus,
    emailStatus,
    linkedinStatus: null,
  });
  // Step 6 notification read.
  prismaMock.campaignDeploy.findUnique.mockResolvedValue({
    status: finalDeployStatus,
    leadCount: 0,
    emailStepCount: 0,
    linkedinStepCount: 0,
    emailStatus,
    linkedinStatus: null,
    error: null,
  });
  // Auto-transition deployed→active (happy path only).
  prismaMock.campaign.updateMany.mockResolvedValue({ count: 1 });
}

function seedTxRollbackState(opts: {
  preCatchDeployStatus?: string;
  inflightSibling?: { id: string } | null;
  preRollbackEbId?: number | null;
  rollbackCount?: number;
} = {}) {
  const {
    preCatchDeployStatus = "running",
    inflightSibling = null,
    preRollbackEbId = 10099,
    rollbackCount = 1,
  } = opts;

  txMock.campaignDeploy.findUnique.mockResolvedValue({
    status: preCatchDeployStatus,
  });
  txMock.campaignDeploy.update.mockResolvedValue({});
  txMock.campaignDeploy.findFirst.mockResolvedValue(inflightSibling);
  txMock.campaign.findUnique.mockResolvedValue({
    emailBisonCampaignId: preRollbackEbId,
    status: "deployed",
  });
  txMock.campaign.updateMany.mockResolvedValue({ count: rollbackCount });
  txMock.auditLog.create.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the initial status→running write at executeDeploy entry always
  // succeeds.
  prismaMock.campaignDeploy.update.mockResolvedValue({});
  // Adapter succeeds by default; individual tests override to throw.
  adapterDeployMock.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Case 1 — happy path
// ---------------------------------------------------------------------------

describe("executeDeploy — BL-075 atomic rollback (Bundle B)", () => {
  it("case 1: happy path — deploy succeeds, NO rollback fires, NO auto-rollback AuditLog", async () => {
    seedHappyCampaign();
    seedPostDeploySnapshot({ finalDeployStatus: "complete" });

    await executeDeploy(CAMPAIGN_ID, DEPLOY_ID);

    // The rollback tx should never have been entered on the happy path.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    // Defence-in-depth: none of the rollback tx-scoped writes fired.
    expect(txMock.campaign.updateMany).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    // Adapter was invoked once (email channel).
    expect(adapterDeployMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Case 2 — terminal failure, no inflight sibling: full rollback
  // -------------------------------------------------------------------------
  it("case 2: terminal failure + no inflight sibling — atomic rollback flips Campaign + CampaignDeploy + audits, all in one tx", async () => {
    seedHappyCampaign();
    seedTxRollbackState({
      preCatchDeployStatus: "running",
      inflightSibling: null,
      preRollbackEbId: 10099,
      rollbackCount: 1,
    });

    const err = new Error("[step:6] attach-sender-emails 422 Unprocessable Entity");
    adapterDeployMock.mockRejectedValueOnce(err);

    await expect(executeDeploy(CAMPAIGN_ID, DEPLOY_ID)).rejects.toThrow(
      /attach-sender-emails 422/,
    );

    // Single atomic $transaction.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    // CampaignDeploy.status → 'failed' (inside tx, not outer client).
    expect(txMock.campaignDeploy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEPLOY_ID },
        data: expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("[step:6]"),
          completedAt: expect.any(Date),
        }),
      }),
    );

    // Inflight-sibling check ran INSIDE the tx with the exact status filter
    // shape the brief specifies (pending OR running).
    expect(txMock.campaignDeploy.findFirst).toHaveBeenCalledWith({
      where: {
        campaignId: CAMPAIGN_ID,
        status: { in: ["pending", "running"] },
        id: { not: DEPLOY_ID },
      },
      select: { id: true },
    });

    // Snapshot of emailBisonCampaignId was read BEFORE the rollback so the
    // audit metadata can capture it.
    expect(txMock.campaign.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CAMPAIGN_ID },
      }),
    );

    // Campaign rollback — guarded by status='deployed', flips all three fields.
    expect(txMock.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID, status: "deployed" },
      data: {
        status: "approved",
        emailBisonCampaignId: null,
        deployedAt: null,
      },
    });

    // AuditLog with the exact action name the brief mandates.
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    const auditCall = txMock.auditLog.create.mock.calls[0]?.[0];
    expect(auditCall.data.action).toBe(
      "campaign.status.auto_rollback_on_deploy_failure",
    );
    expect(auditCall.data.entityType).toBe("Campaign");
    expect(auditCall.data.entityId).toBe(CAMPAIGN_ID);
    expect(auditCall.data.adminEmail).toBe(SYSTEM_ADMIN_EMAIL);

    // The outer-client Campaign.updateMany (auto deployed→active on success)
    // MUST NOT have been invoked on the failure path.
    expect(prismaMock.campaign.updateMany).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 3 — terminal failure WITH inflight sibling: skip Campaign rollback
  // -------------------------------------------------------------------------
  it("case 3: terminal failure + inflight sibling — CampaignDeploy flipped to failed, Campaign UNTOUCHED, NO audit", async () => {
    seedHappyCampaign();
    seedTxRollbackState({
      preCatchDeployStatus: "running",
      inflightSibling: { id: "deploy_retry_sibling" },
    });

    const err = new Error("[step:3] EB 500");
    adapterDeployMock.mockRejectedValueOnce(err);

    await expect(executeDeploy(CAMPAIGN_ID, DEPLOY_ID)).rejects.toThrow(/EB 500/);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    // The current-deploy row WAS marked failed (existing contract preserved).
    expect(txMock.campaignDeploy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEPLOY_ID },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );

    // Inflight check fired.
    expect(txMock.campaignDeploy.findFirst).toHaveBeenCalledTimes(1);

    // Campaign rollback MUST NOT fire — a retry is in flight.
    expect(txMock.campaign.updateMany).not.toHaveBeenCalled();
    // Snapshot read also skipped (guarded behind the sibling check).
    expect(txMock.campaign.findUnique).not.toHaveBeenCalled();
    // AuditLog silent — the retry's own catch will audit the eventual
    // terminal outcome.
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 4 — AuditLog metadata shape + 500-char clip
  // -------------------------------------------------------------------------
  it("case 4: AuditLog metadata shape — action + all required fields + reason clipped at 500 chars + clearedEmailBisonCampaignId matches snapshot", async () => {
    seedHappyCampaign();
    seedTxRollbackState({
      preRollbackEbId: 10077,
      rollbackCount: 1,
    });

    // Construct an error message that trips the [step:N] extractor AND
    // exceeds the 500-char clip threshold so we can assert both behaviours.
    const longReason =
      "[step:7] EB update 500 Internal Server Error — " + "x".repeat(600);
    adapterDeployMock.mockRejectedValueOnce(new Error(longReason));

    await expect(executeDeploy(CAMPAIGN_ID, DEPLOY_ID)).rejects.toThrow();

    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
    const auditCall = txMock.auditLog.create.mock.calls[0]?.[0];

    // Action string — exact match.
    expect(auditCall.data.action).toBe(
      "campaign.status.auto_rollback_on_deploy_failure",
    );

    // Metadata contains every required key.
    const meta = auditCall.data.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      fromCampaignStatus: "deployed",
      toCampaignStatus: "approved",
      erroredStep: "[step:7]",
      campaignDeployId: DEPLOY_ID,
      clearedEmailBisonCampaignId: 10077,
    });
    // Reason key present and clipped at 500 chars.
    expect(typeof meta.reason).toBe("string");
    expect((meta.reason as string).length).toBeLessThanOrEqual(500);
    // Clip should retain the prefix that carried the [step:7] tag.
    expect(meta.reason as string).toMatch(/^\[step:7\]/);
  });

  // -------------------------------------------------------------------------
  // Case 5 — Campaign already moved off 'deployed' (e.g. manually paused):
  //          rollback updateMany count=0, no audit row, CampaignDeploy still
  //          flipped.
  // -------------------------------------------------------------------------
  it("case 5: Campaign already moved off 'deployed' (manual pause mid-deploy) — updateMany misses, NO audit row, CampaignDeploy still flipped", async () => {
    seedHappyCampaign();
    seedTxRollbackState({
      preCatchDeployStatus: "running",
      inflightSibling: null,
      preRollbackEbId: 10088,
      // Someone paused the Campaign mid-deploy — the status-guard on
      // updateMany misses and returns count=0.
      rollbackCount: 0,
    });

    adapterDeployMock.mockRejectedValueOnce(new Error("[step:5] some failure"));

    await expect(executeDeploy(CAMPAIGN_ID, DEPLOY_ID)).rejects.toThrow();

    // CampaignDeploy was still flipped to failed (existing contract).
    expect(txMock.campaignDeploy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DEPLOY_ID },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
    // Campaign rollback was ATTEMPTED…
    expect(txMock.campaign.updateMany).toHaveBeenCalledTimes(1);
    // …but count=0, so the audit row was NOT written.
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 6 — preserve existing CampaignDeploy guard: if a channel-level
  //          handler already wrote status='failed', the outer catch must
  //          NOT clobber that write (existing contract from pre-BL-075).
  // -------------------------------------------------------------------------
  it("case 6: preserve existing CampaignDeploy guard — channel handler already flipped to 'failed', outer catch skips the tx.campaignDeploy.update", async () => {
    seedHappyCampaign();
    seedTxRollbackState({
      preCatchDeployStatus: "failed", // already-terminal from channel adapter
      inflightSibling: null,
      preRollbackEbId: 10066,
      rollbackCount: 1,
    });

    adapterDeployMock.mockRejectedValueOnce(
      new Error("[step:6] adapter already wrote failed"),
    );

    await expect(executeDeploy(CAMPAIGN_ID, DEPLOY_ID)).rejects.toThrow();

    // No CampaignDeploy.update inside the tx — the guard
    // (currentDeploy.status === 'running') blocked the write.
    expect(txMock.campaignDeploy.update).not.toHaveBeenCalled();

    // Campaign rollback STILL fires (the guard is only on the
    // CampaignDeploy terminal write, not on the Campaign rollback path).
    expect(txMock.campaign.updateMany).toHaveBeenCalledTimes(1);
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
