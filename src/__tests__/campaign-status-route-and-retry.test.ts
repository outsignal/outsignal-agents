import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      json: async () => body,
      status: init?.status ?? 200,
    }),
  },
}));

const triggerMock = vi.fn();
vi.mock("@trigger.dev/sdk/v3", () => ({
  tasks: {
    trigger: (...args: unknown[]) => triggerMock(...args),
  },
}));

const requireAdminAuthMock = vi.fn();
vi.mock("@/lib/require-admin-auth", () => ({
  requireAdminAuth: (...args: unknown[]) => requireAdminAuthMock(...args),
}));

const updateCampaignStatusMock = vi.fn();
const getCampaignMock = vi.fn();
vi.mock("@/lib/campaigns/operations", () => ({
  updateCampaignStatus: (...args: unknown[]) => updateCampaignStatusMock(...args),
  getCampaign: (...args: unknown[]) => getCampaignMock(...args),
}));

const pauseCampaignChannelsMock = vi.fn();
const resumeCampaignChannelsMock = vi.fn();
vi.mock("@/lib/campaigns/lifecycle", () => ({
  pauseCampaignChannels: (...args: unknown[]) => pauseCampaignChannelsMock(...args),
  resumeCampaignChannels: (...args: unknown[]) => resumeCampaignChannelsMock(...args),
}));

const adapterDeployMock = vi.fn();
vi.mock("@/lib/channels", () => ({
  initAdapters: vi.fn(),
  getAdapter: () => ({ deploy: adapterDeployMock }),
}));

vi.mock("@/lib/notifications", () => ({
  notifyDeploy: vi.fn().mockResolvedValue(undefined),
  notifyCampaignLive: vi.fn().mockResolvedValue(undefined),
}));

const txCampaign = {
  updateMany: vi.fn(),
};
const txCampaignDeploy = {
  create: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        campaign: txCampaign,
        campaignDeploy: txCampaignDeploy,
      }),
    ),
    campaignDeploy: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { retryDeployChannel } from "@/lib/campaigns/deploy";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/campaigns/camp-1/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("campaign status route + retry CAS guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminAuthMock.mockResolvedValue({ email: "admin@example.com", role: "admin" });
    pauseCampaignChannelsMock.mockResolvedValue(undefined);
    resumeCampaignChannelsMock.mockResolvedValue(undefined);
  });

  it("creates the first LinkedIn deploy only when the deployedAt claim succeeds", async () => {
    updateCampaignStatusMock.mockResolvedValue({
      id: "camp-1",
      name: "LinkedIn Campaign",
      workspaceSlug: "acme",
      channels: ["linkedin"],
    });
    txCampaign.updateMany.mockResolvedValue({ count: 1 });
    txCampaignDeploy.create.mockResolvedValue({ id: "deploy-1" });

    const { POST } = await import("@/app/api/campaigns/[id]/status/route");
    const res = await POST(postRequest({ status: "active" }), {
      params: Promise.resolve({ id: "camp-1" }),
    });

    expect(res.status).toBe(200);
    expect(txCampaign.updateMany).toHaveBeenCalledWith({
      where: { id: "camp-1", status: "active", deployedAt: null },
      data: { deployedAt: expect.any(Date) },
    });
    expect(txCampaignDeploy.create).toHaveBeenCalled();
    expect(triggerMock).toHaveBeenCalledWith("campaign-deploy", {
      campaignId: "camp-1",
      deployId: "deploy-1",
    });
    expect(resumeCampaignChannelsMock).not.toHaveBeenCalled();
  });

  it("treats a lost deployedAt claim as re-activation and resumes channels instead", async () => {
    updateCampaignStatusMock.mockResolvedValue({
      id: "camp-1",
      name: "LinkedIn Campaign",
      workspaceSlug: "acme",
      channels: ["linkedin"],
    });
    txCampaign.updateMany.mockResolvedValue({ count: 0 });

    const { POST } = await import("@/app/api/campaigns/[id]/status/route");
    const res = await POST(postRequest({ status: "active" }), {
      params: Promise.resolve({ id: "camp-1" }),
    });

    expect(res.status).toBe(200);
    expect(txCampaignDeploy.create).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
    expect(resumeCampaignChannelsMock).toHaveBeenCalledWith("camp-1");
  });

  it("returns 409 when the status change loses an optimistic concurrency race", async () => {
    updateCampaignStatusMock.mockRejectedValue(
      new Error("Campaign camp-1 was modified concurrently while changing status"),
    );

    const { POST } = await import("@/app/api/campaigns/[id]/status/route");
    const res = await POST(postRequest({ status: "active" }), {
      params: Promise.resolve({ id: "camp-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "Campaign camp-1 was modified concurrently while changing status",
    });
  });

  it("allows only the first retry claimant to reset a failed channel", async () => {
    vi.mocked(prisma.campaignDeploy.findUniqueOrThrow).mockResolvedValue({
      campaignId: "camp-1",
      campaignName: "Retry Campaign",
      workspaceSlug: "acme",
      channels: JSON.stringify(["email"]),
    } as never);
    vi.mocked(prisma.campaignDeploy.updateMany).mockResolvedValue({ count: 1 } as never);
    getCampaignMock.mockResolvedValue({
      id: "camp-1",
      name: "Retry Campaign",
      workspaceSlug: "acme",
      channels: ["email"],
      status: "deployed",
    });
    adapterDeployMock.mockResolvedValue(undefined);
    vi.mocked(prisma.campaignDeploy.findUnique).mockResolvedValue({
      status: "complete",
      emailStatus: "complete",
      linkedinStatus: null,
      leadCount: 0,
      emailStepCount: 0,
      linkedinStepCount: 0,
      error: null,
    } as never);
    vi.mocked(prisma.campaignDeploy.update).mockResolvedValue({} as never);

    await retryDeployChannel("deploy-1", "email");

    expect(prisma.campaignDeploy.updateMany).toHaveBeenCalledWith({
      where: {
        id: "deploy-1",
        status: { in: ["failed", "partial_failure"] },
        emailStatus: "failed",
      },
      data: {
        status: "running",
        emailStatus: "pending",
        emailError: null,
        retryChannel: "email",
        completedAt: null,
        error: null,
      },
    });
    expect(adapterDeployMock).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate retry claims after another worker already reclaimed the channel", async () => {
    vi.mocked(prisma.campaignDeploy.findUniqueOrThrow).mockResolvedValue({
      campaignId: "camp-1",
      campaignName: "Retry Campaign",
      workspaceSlug: "acme",
      channels: JSON.stringify(["linkedin"]),
    } as never);
    vi.mocked(prisma.campaignDeploy.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(retryDeployChannel("deploy-1", "linkedin")).rejects.toThrow(
      /not eligible for linkedin retry/i,
    );
    expect(adapterDeployMock).not.toHaveBeenCalled();
  });

  it("resets a claimed retry back to failed when deploy work throws after the claim", async () => {
    vi.mocked(prisma.campaignDeploy.findUniqueOrThrow).mockResolvedValue({
      campaignId: "camp-1",
      campaignName: "Retry Campaign",
      workspaceSlug: "acme",
      channels: JSON.stringify(["email"]),
    } as never);
    vi.mocked(prisma.campaignDeploy.updateMany).mockResolvedValue({ count: 1 } as never);
    getCampaignMock.mockResolvedValue({
      id: "camp-1",
      name: "Retry Campaign",
      workspaceSlug: "acme",
      channels: ["email"],
      status: "deployed",
    });
    adapterDeployMock.mockRejectedValue(new Error("deploy exploded"));
    vi.mocked(prisma.campaignDeploy.update).mockResolvedValue({} as never);
    vi.mocked(prisma.campaignDeploy.findUniqueOrThrow).mockResolvedValueOnce({
      campaignId: "camp-1",
      campaignName: "Retry Campaign",
      workspaceSlug: "acme",
      channels: JSON.stringify(["email"]),
    } as never);
    vi.mocked(prisma.campaignDeploy.findUniqueOrThrow).mockResolvedValueOnce({
      status: "failed",
      emailStatus: "failed",
      linkedinStatus: null,
    } as never);

    await expect(retryDeployChannel("deploy-1", "email")).rejects.toThrow(
      /deploy exploded/i,
    );
    expect(prisma.campaignDeploy.update).toHaveBeenNthCalledWith(1, {
      where: { id: "deploy-1" },
      data: {
        emailStatus: "failed",
        emailError: "deploy exploded",
        retryChannel: null,
        completedAt: expect.any(Date),
      },
    });
    expect(prisma.campaignDeploy.update).toHaveBeenNthCalledWith(2, {
      where: { id: "deploy-1" },
      data: {
        status: "failed",
        error: "deploy exploded",
        completedAt: expect.any(Date),
      },
    });
  });

  it("replaces stale top-level error text with the currently failed channel on partial_failure", async () => {
    vi.mocked(prisma.campaignDeploy.findUniqueOrThrow).mockResolvedValue({
      campaignId: "camp-1",
      campaignName: "Retry Campaign",
      workspaceSlug: "acme",
      channels: JSON.stringify(["email", "linkedin"]),
    } as never);
    vi.mocked(prisma.campaignDeploy.updateMany).mockResolvedValue({ count: 1 } as never);
    getCampaignMock.mockResolvedValue({
      id: "camp-1",
      name: "Retry Campaign",
      workspaceSlug: "acme",
      channels: ["email", "linkedin"],
      status: "deployed",
    });
    adapterDeployMock.mockRejectedValue(new Error("email deploy exploded"));
    vi.mocked(prisma.campaignDeploy.update).mockResolvedValue({} as never);
    vi.mocked(prisma.campaignDeploy.findUniqueOrThrow).mockResolvedValueOnce({
      campaignId: "camp-1",
      campaignName: "Retry Campaign",
      workspaceSlug: "acme",
      channels: JSON.stringify(["email", "linkedin"]),
    } as never);
    vi.mocked(prisma.campaignDeploy.findUniqueOrThrow).mockResolvedValueOnce({
      emailStatus: "failed",
      linkedinStatus: "complete",
      emailError: "email deploy exploded",
      linkedinError: null,
    } as never);

    await expect(retryDeployChannel("deploy-1", "email")).rejects.toThrow(
      /email deploy exploded/i,
    );

    expect(prisma.campaignDeploy.update).toHaveBeenNthCalledWith(2, {
      where: { id: "deploy-1" },
      data: {
        status: "partial_failure",
        error: "email: email deploy exploded",
        completedAt: expect.any(Date),
      },
    });
  });
});
