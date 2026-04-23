import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ebMock, getCampaignMock, notifyMock, prismaMock } = vi.hoisted(() => ({
  ebMock: {
    createCampaign: vi.fn(),
    getCampaign: vi.fn(),
    deleteCampaign: vi.fn(),
    getSequenceSteps: vi.fn(),
    createSequenceSteps: vi.fn(),
    createLead: vi.fn(),
    createOrUpdateLeadsMultiple: vi.fn(),
    ensureCustomVariables: vi.fn(),
    attachLeadsToCampaign: vi.fn(),
    getSchedule: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    attachSenderEmails: vi.fn(),
    updateCampaign: vi.fn(),
    resumeCampaign: vi.fn(),
  },
  getCampaignMock: vi.fn(),
  notifyMock: vi.fn(),
  prismaMock: {
    workspace: { findUniqueOrThrow: vi.fn() },
    campaign: { update: vi.fn(), findUnique: vi.fn() },
    campaignDeploy: { update: vi.fn() },
    targetListPerson: { findMany: vi.fn() },
    webhookEvent: { findFirst: vi.fn() },
    sender: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/emailbison/client", () => ({
  EmailBisonClient: class {
    constructor() {
      return ebMock;
    }
  },
  EmailBisonApiError: class extends Error {
    isRecordNotFound = false;
  },
}));

vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (...args: unknown[]) => getCampaignMock(...args),
}));

vi.mock("@/lib/utils/retry", () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("@/lib/notify", () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { EmailAdapter } from "@/lib/channels/email-adapter";

const BASE_DEPLOY_PARAMS = {
  deployId: "deploy-partial",
  campaignId: "camp-partial",
  campaignName: "Partial Upload Campaign",
  workspaceSlug: "acme",
  channels: ["email"],
};

function fakeEntries(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    person: {
      email: `lead${i}@acme.com`,
      firstName: `First${i}`,
      lastName: `Last${i}`,
      jobTitle: "Role",
      company: "Acme Ltd",
      companyDomain: "acme.com",
      location: "London",
      workspaces: [],
    },
  }));
}

function seedHappyPrereqs() {
  prismaMock.workspace.findUniqueOrThrow.mockResolvedValue({
    apiToken: "ws-token",
  });

  getCampaignMock.mockResolvedValue({
    id: "camp-partial",
    targetListId: "tl-partial",
    description: "Partial upload deploy",
    emailBisonCampaignId: null,
    emailSequence: [
      { position: 1, subjectLine: "hi", body: "hello", delayDays: 0 },
    ],
  });

  ebMock.createCampaign.mockResolvedValue({ id: 9999, uuid: "uuid-9999" });
  ebMock.getSequenceSteps.mockResolvedValue([]);
  ebMock.createSequenceSteps.mockResolvedValue([
    {
      id: 1,
      campaign_id: 9999,
      position: 1,
      subject: "hi",
      body: "hello",
      delay_days: 1,
    },
  ]);
  ebMock.ensureCustomVariables.mockResolvedValue(undefined);
  ebMock.attachLeadsToCampaign.mockResolvedValue(undefined);
  ebMock.createSchedule.mockResolvedValue({});
  ebMock.getSchedule.mockResolvedValue(null);
  ebMock.attachSenderEmails.mockResolvedValue(undefined);
  ebMock.updateCampaign.mockResolvedValue({});
  ebMock.resumeCampaign.mockResolvedValue({});
  ebMock.getCampaign.mockResolvedValue({ id: 9999, status: "active" });

  prismaMock.sender.findMany.mockResolvedValue([{ emailBisonSenderId: 501 }]);
  prismaMock.campaignDeploy.update.mockResolvedValue({});
  prismaMock.campaign.update.mockResolvedValue({});
  prismaMock.webhookEvent.findFirst.mockResolvedValue(null);
}

describe("EmailAdapter.deploy Step 4 — partial lead upload handling", () => {
  let adapter: EmailAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new EmailAdapter();
    seedHappyPrereqs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails closed by default when EB accepts fewer leads than attempted", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue(fakeEntries(500));
    ebMock.createOrUpdateLeadsMultiple.mockResolvedValue(
      Array.from({ length: 450 }, (_, i) => ({
        id: 7000 + i,
        email: `lead${i}@acme.com`,
        status: "active",
      })),
    );

    await expect(adapter.deploy(BASE_DEPLOY_PARAMS)).rejects.toThrow(
      /EmailBison accepted 450\/500 leads in Step 4/i,
    );

    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "error",
        title: "Partial EmailBison lead upload blocked deploy",
        workspaceSlug: "acme",
        metadata: expect.objectContaining({
          attemptedCount: 500,
          acceptedCount: 450,
          rejectedCount: 50,
          allowPartial: false,
        }),
      }),
    );
    expect(ebMock.attachLeadsToCampaign).not.toHaveBeenCalled();

    const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      where: { id: "deploy-partial" },
      data: {
        emailStatus: "failed",
      },
    });
    expect(finalUpdate?.data?.emailError).toMatch(/\[step:4\]/);
  });

  it("continues with a degraded summary when allowPartial=true", async () => {
    prismaMock.targetListPerson.findMany.mockResolvedValue(fakeEntries(500));
    ebMock.createOrUpdateLeadsMultiple.mockResolvedValue(
      Array.from({ length: 450 }, (_, i) => ({
        id: 8000 + i,
        email: `lead${i}@acme.com`,
        status: "active",
      })),
    );

    await adapter.deploy({
      ...BASE_DEPLOY_PARAMS,
      allowPartial: true,
    });

    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        title: "Partial EmailBison lead upload allowed",
        workspaceSlug: "acme",
        metadata: expect.objectContaining({
          attemptedCount: 500,
          acceptedCount: 450,
          rejectedCount: 50,
          allowPartial: true,
        }),
      }),
    );
    expect(ebMock.attachLeadsToCampaign).toHaveBeenCalledTimes(1);
    expect(ebMock.attachLeadsToCampaign.mock.calls[0][1]).toHaveLength(450);

    const finalUpdate = prismaMock.campaignDeploy.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate).toMatchObject({
      where: { id: "deploy-partial" },
      data: {
        emailStatus: "complete",
        leadCount: 450,
      },
    });
    expect(finalUpdate?.data?.emailError).toMatch(/PARTIAL_UPLOAD allowed/i);
    expect(finalUpdate?.data?.emailError).toMatch(/accepted 450\/500 leads/i);
  });
});
