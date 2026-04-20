/**
 * executeDeploy skipResume option — stage-then-launch unit coverage.
 *
 * Contract under test: when executeDeploy is invoked with
 * `{ skipResume: true }`, the orchestrator MUST
 *   (1) forward `skipResume: true` onto the channel adapter's deploy params,
 *       so the adapter can skip its own launch/verify steps; and
 *   (2) skip the post-finalize auto-transition of Campaign.status from
 *       'deployed' → 'active'. The campaign stays at 'deployed' so the
 *       PM can review the staged EB campaign (which remains in DRAFT
 *       server-side) before launching manually.
 *
 * Complementing `deploy-rollback.test.ts` (which asserts failure paths)
 * this file's happy-path assertions specifically cover the skipResume
 * branch — rollback semantics are unchanged and not re-tested here.
 *
 * Mock style mirrors `deploy-rollback.test.ts`: vi.hoisted with
 * `prismaMock` / `adapterDeployMock` / `getCampaignMock`, and a shared
 * `txMock` whose writes should never fire on the happy path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { txMock, prismaMock, getCampaignMock, adapterDeployMock } = vi.hoisted(() => {
  const tx = {
    campaignDeploy: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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
      campaignDeploy: {
        update: vi.fn(),
        updateMany: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      campaign: {
        updateMany: vi.fn(),
      },
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

vi.mock("@/lib/channels", () => ({
  initAdapters: vi.fn(),
  getAdapter: () => ({ deploy: adapterDeployMock }),
}));

vi.mock("@/lib/notifications", () => ({
  notifyDeploy: vi.fn().mockResolvedValue(undefined),
  notifyCampaignLive: vi.fn().mockResolvedValue(undefined),
}));

import { executeDeploy } from "@/lib/campaigns/deploy";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CAMPAIGN_ID = "camp_skip_resume_1";
const DEPLOY_ID = "deploy_skip_resume_1";

function seedHappyCampaign() {
  getCampaignMock.mockResolvedValue({
    id: CAMPAIGN_ID,
    name: "SkipResume Test Campaign",
    workspaceSlug: "test-ws",
    status: "deployed",
    channels: ["email"],
  });
}

function seedPostDeploySnapshot() {
  prismaMock.campaignDeploy.findUniqueOrThrow.mockResolvedValue({
    status: "complete",
    emailStatus: "complete",
    linkedinStatus: null,
  });
  prismaMock.campaignDeploy.findUnique.mockResolvedValue({
    status: "complete",
    leadCount: 0,
    emailStepCount: 0,
    linkedinStepCount: 0,
    emailStatus: "complete",
    linkedinStatus: null,
    error: "stale error from prior failed attempt",
  });
  // Auto-transition deployed→active (should NOT fire on skipResume path).
  prismaMock.campaign.updateMany.mockResolvedValue({ count: 1 });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.campaignDeploy.update.mockResolvedValue({});
  prismaMock.campaignDeploy.updateMany.mockResolvedValue({ count: 1 });
  // Fresh-first-attempt entry read.
  prismaMock.campaignDeploy.findUniqueOrThrow.mockImplementationOnce(() =>
    Promise.resolve({
      status: "pending",
      emailBisonCampaignId: null,
    }),
  );
  adapterDeployMock.mockResolvedValue(undefined);
});

describe("executeDeploy — skipResume stage-deploy option", () => {
  it("skipResume=true: adapter is invoked with skipResume=true AND Campaign.status auto-transition deployed→active does NOT fire", async () => {
    seedHappyCampaign();
    seedPostDeploySnapshot();

    await executeDeploy(CAMPAIGN_ID, DEPLOY_ID, { skipResume: true });

    // 1. Adapter received skipResume=true on its DeployParams so it can
    //    skip its own launch/verify steps.
    expect(adapterDeployMock).toHaveBeenCalledTimes(1);
    const adapterCall = adapterDeployMock.mock.calls[0]?.[0];
    expect(adapterCall).toMatchObject({
      deployId: DEPLOY_ID,
      campaignId: CAMPAIGN_ID,
      campaignName: "SkipResume Test Campaign",
      workspaceSlug: "test-ws",
      skipResume: true,
    });

    // 2. The outer Campaign.updateMany (auto deployed→active) MUST NOT
    //    have fired — the campaign stays at 'deployed' so the PM can
    //    review the staged EB campaign before launching manually.
    expect(prismaMock.campaign.updateMany).not.toHaveBeenCalled();

    // 3. Happy path: no rollback $transaction.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();

    // 4. Finalizer clears stale overall CampaignDeploy.error on success.
    expect(prismaMock.campaignDeploy.update).toHaveBeenCalledWith({
      where: { id: DEPLOY_ID },
      data: {
        status: "complete",
        error: null,
        completedAt: expect.any(Date),
      },
    });
  });

  it("default (no opts): adapter receives skipResume=false AND Campaign.status auto-transition deployed→active DOES fire", async () => {
    seedHappyCampaign();
    seedPostDeploySnapshot();

    await executeDeploy(CAMPAIGN_ID, DEPLOY_ID);

    // Adapter received skipResume=false (default behaviour preserved).
    expect(adapterDeployMock).toHaveBeenCalledTimes(1);
    const adapterCall = adapterDeployMock.mock.calls[0]?.[0];
    expect(adapterCall).toMatchObject({
      deployId: DEPLOY_ID,
      skipResume: false,
    });

    // Auto-transition deployed→active DID fire on the normal path.
    expect(prismaMock.campaign.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: CAMPAIGN_ID, status: "deployed" },
      data: { status: "active" },
    });

    // Finalizer clears stale overall CampaignDeploy.error on success.
    expect(prismaMock.campaignDeploy.update).toHaveBeenCalledWith({
      where: { id: DEPLOY_ID },
      data: {
        status: "complete",
        error: null,
        completedAt: expect.any(Date),
      },
    });
  });
});
