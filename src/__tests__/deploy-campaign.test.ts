/**
 * BL-061 — initiateCampaignDeploy (shared helper) tests.
 *
 * Coverage:
 *   - Happy path (approved + both approvals → deployed, trigger fired)
 *   - Missing approvals → { ok:false, code:'missing_approvals' }
 *   - Wrong status (not 'approved') → { ok:false, code:'not_approved' }
 *   - Already-deployed (updateMany count=0) → { ok:false, code:'already_deployed' }
 *   - Missing campaign → { ok:false, code:'not_found' }
 *   - Dry-run: returns the what-would-happen shape WITHOUT mutating or
 *     firing the deploy trigger. The trigger mock assertion is the key
 *     guard — dry-run must never reach tasks.trigger().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CampaignDetail } from "@/lib/campaigns/operations";

// Mock the Trigger.dev SDK before the helper imports it.
const triggerMock = vi.fn();
vi.mock("@trigger.dev/sdk/v3", () => ({
  tasks: {
    trigger: (...args: unknown[]) => triggerMock(...args),
  },
}));

// Mock getCampaign (operations module) — we drive it per test.
const getCampaignMock = vi.fn<
  (id: string) => Promise<CampaignDetail | null>
>();
vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (id: string) => getCampaignMock(id),
}));

// Mock auditLog so we can assert it is called with the right shape.
const auditLogMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  auditLog: (...args: unknown[]) => auditLogMock(...args),
}));

import { prisma } from "@/lib/db";
import {
  initiateCampaignDeploy,
  deployFailureHttpStatus,
} from "@/lib/campaigns/deploy-campaign";

/* eslint-disable @typescript-eslint/no-explicit-any */
const prismaAny = prisma as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Build a minimally valid CampaignDetail for the helper's needs. */
function fakeCampaign(
  overrides: Partial<CampaignDetail> = {},
): CampaignDetail {
  const base: CampaignDetail = {
    id: "camp-1",
    name: "Acme E1",
    workspaceSlug: "acme",
    type: "static",
    status: "approved",
    channels: ["email"],
    targetListName: "Acme target",
    targetListLeadCount: 100,
    emailBisonCampaignId: null,
    leadsApproved: true,
    contentApproved: true,
    createdAt: new Date("2026-04-10T00:00:00Z"),
    updatedAt: new Date("2026-04-14T00:00:00Z"),
    description: null,
    emailSequence: null,
    linkedinSequence: null,
    copyStrategy: null,
    targetListId: "tl-1",
    targetListPeopleCount: 100,
    leadsFeedback: null,
    leadsApprovedAt: new Date("2026-04-14T00:00:00Z"),
    contentFeedback: null,
    contentApprovedAt: new Date("2026-04-14T00:00:00Z"),
    approvedContentHash: null,
    approvedContentSnapshot: null,
    publishedAt: null,
    deployedAt: null,
    icpCriteria: null,
    signalTypes: null,
    dailyLeadCap: 0,
    icpScoreThreshold: 40,
    signalEmailBisonCampaignId: null,
    lastSignalProcessedAt: null,
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaAny.campaignDeploy = { create: vi.fn() };
  prismaAny.campaign.updateMany = vi.fn();
});

describe("initiateCampaignDeploy — happy path", () => {
  it("transitions approved->deployed, creates CampaignDeploy, fires trigger, writes audit log", async () => {
    const campaign = fakeCampaign({ channels: ["email", "linkedin"] });
    getCampaignMock.mockResolvedValue(campaign);
    prismaAny.campaign.updateMany.mockResolvedValue({ count: 1 });
    prismaAny.campaignDeploy.create.mockResolvedValue({ id: "deploy-1" });

    const result = await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
    });

    expect(result).toEqual({
      ok: true,
      dryRun: false,
      deployId: "deploy-1",
      beforeStatus: "approved",
      afterStatus: "deployed",
      channels: ["email", "linkedin"],
      campaignName: "Acme E1",
      workspaceSlug: "acme",
    });

    // Atomic transition uses the status guard.
    expect(prismaAny.campaign.updateMany).toHaveBeenCalledWith({
      where: { id: "camp-1", status: "approved" },
      data: expect.objectContaining({ status: "deployed" }),
    });

    // Deploy row persists the channels and per-channel pending/skipped.
    expect(prismaAny.campaignDeploy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: "camp-1",
        campaignName: "Acme E1",
        workspaceSlug: "acme",
        status: "pending",
        channels: JSON.stringify(["email", "linkedin"]),
        emailStatus: "pending",
        linkedinStatus: "pending",
      }),
    });

    expect(triggerMock).toHaveBeenCalledWith("campaign-deploy", {
      campaignId: "camp-1",
      deployId: "deploy-1",
      allowPartial: false,
      allowMissingLastName: false,
    });

    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "campaign.deploy",
        entityType: "Campaign",
        entityId: "camp-1",
        adminEmail: "ops@outsignal.ai",
        metadata: expect.objectContaining({
          campaignName: "Acme E1",
          workspaceSlug: "acme",
          channels: ["email", "linkedin"],
          deployId: "deploy-1",
          allowPartial: false,
          allowMissingLastName: false,
        }),
      }),
    );
  });

  it("threads allowPartial and allowMissingLastName through the trigger payload and audit metadata", async () => {
    getCampaignMock.mockResolvedValue(fakeCampaign({ channels: ["email"] }));
    prismaAny.campaign.updateMany.mockResolvedValue({ count: 1 });
    prismaAny.campaignDeploy.create.mockResolvedValue({ id: "deploy-allow-partial" });

    await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
      allowPartial: true,
      allowMissingLastName: true,
    });

    expect(triggerMock).toHaveBeenCalledWith("campaign-deploy", {
      campaignId: "camp-1",
      deployId: "deploy-allow-partial",
      allowPartial: true,
      allowMissingLastName: true,
    });
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          allowPartial: true,
          allowMissingLastName: true,
        }),
      }),
    );
  });

  it("marks non-email channels as 'skipped' on the deploy row", async () => {
    getCampaignMock.mockResolvedValue(fakeCampaign({ channels: ["linkedin"] }));
    prismaAny.campaign.updateMany.mockResolvedValue({ count: 1 });
    prismaAny.campaignDeploy.create.mockResolvedValue({ id: "deploy-2" });

    await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
    });

    const createCall = prismaAny.campaignDeploy.create.mock.calls[0][0];
    expect(createCall.data.emailStatus).toBe("skipped");
    expect(createCall.data.linkedinStatus).toBe("pending");
  });
});

describe("initiateCampaignDeploy — failure paths", () => {
  it("returns code='not_found' when campaign does not exist", async () => {
    getCampaignMock.mockResolvedValue(null);

    const result = await initiateCampaignDeploy({
      campaignId: "nope",
      adminEmail: "ops@outsignal.ai",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_found");
    }
    expect(prismaAny.campaign.updateMany).not.toHaveBeenCalled();
    expect(prismaAny.campaignDeploy.create).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("returns code='missing_approvals' when leadsApproved=false", async () => {
    getCampaignMock.mockResolvedValue(
      fakeCampaign({ leadsApproved: false, contentApproved: true }),
    );

    const result = await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing_approvals");
      expect(result.reason).toMatch(/leadsApproved=false/);
    }
    expect(prismaAny.campaign.updateMany).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("returns code='missing_approvals' when contentApproved=false", async () => {
    getCampaignMock.mockResolvedValue(
      fakeCampaign({ leadsApproved: true, contentApproved: false }),
    );

    const result = await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing_approvals");
    }
  });

  it("returns code='already_deployed' when updateMany count=0 and status='deployed'", async () => {
    // getCampaign returns the current (already-deployed) state, so the helper
    // can distinguish 'already_deployed' from the generic 'not_approved' case.
    getCampaignMock.mockResolvedValue(fakeCampaign({ status: "deployed" }));
    prismaAny.campaign.updateMany.mockResolvedValue({ count: 0 });

    const result = await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("already_deployed");
      expect(result.beforeStatus).toBe("deployed");
    }
    expect(triggerMock).not.toHaveBeenCalled();
    expect(prismaAny.campaignDeploy.create).not.toHaveBeenCalled();
  });

  it("returns code='not_approved' when updateMany count=0 and status is still draft-like", async () => {
    getCampaignMock.mockResolvedValue(
      fakeCampaign({ status: "internal_review" }),
    );
    prismaAny.campaign.updateMany.mockResolvedValue({ count: 0 });

    const result = await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_approved");
      expect(result.beforeStatus).toBe("internal_review");
    }
  });
});

describe("initiateCampaignDeploy — dry-run", () => {
  it("returns would-deploy shape without mutating or firing trigger", async () => {
    getCampaignMock.mockResolvedValue(fakeCampaign({ channels: ["email"] }));

    const result = await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
      dryRun: true,
    });

    expect(result).toEqual({
      ok: true,
      dryRun: true,
      deployId: null,
      beforeStatus: "approved",
      afterStatus: "deployed",
      channels: ["email"],
      campaignName: "Acme E1",
      workspaceSlug: "acme",
    });

    // Integration-style guard: dry-run must NEVER reach any write path.
    expect(prismaAny.campaign.updateMany).not.toHaveBeenCalled();
    expect(prismaAny.campaignDeploy.create).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it("dry-run still flags missing approvals (validation runs first)", async () => {
    getCampaignMock.mockResolvedValue(
      fakeCampaign({ leadsApproved: false }),
    );

    const result = await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
      dryRun: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing_approvals");
    }
    expect(prismaAny.campaign.updateMany).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("dry-run reports already_deployed without touching Prisma", async () => {
    getCampaignMock.mockResolvedValue(fakeCampaign({ status: "active" }));

    const result = await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
      dryRun: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("already_deployed");
      expect(result.beforeStatus).toBe("active");
    }
    expect(prismaAny.campaign.updateMany).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("dry-run reports not_approved for a draft-state campaign", async () => {
    getCampaignMock.mockResolvedValue(fakeCampaign({ status: "draft" }));

    const result = await initiateCampaignDeploy({
      campaignId: "camp-1",
      adminEmail: "ops@outsignal.ai",
      dryRun: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_approved");
      expect(result.beforeStatus).toBe("draft");
    }
  });
});

describe("deployFailureHttpStatus", () => {
  it("maps codes to the pre-refactor HTTP status codes", () => {
    expect(deployFailureHttpStatus("not_found")).toBe(404);
    expect(deployFailureHttpStatus("missing_approvals")).toBe(400);
    expect(deployFailureHttpStatus("already_deployed")).toBe(409);
    expect(deployFailureHttpStatus("not_approved")).toBe(409);
  });
});
