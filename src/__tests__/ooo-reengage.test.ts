import { beforeEach, describe, expect, it, vi } from "vitest";

const findPendingRecordMock = vi.fn();
const updateReengagementMock = vi.fn();
const findPersonMock = vi.fn();
const updatePeopleMock = vi.fn();
const findCampaignMock = vi.fn();
const findWorkspaceMock = vi.fn();

const ensureCustomVariablesMock = vi.fn();
const createLeadMock = vi.fn();
const attachLeadsToCampaignMock = vi.fn();
const createCampaignMock = vi.fn();
const createSequenceStepsMock = vi.fn();
const campaignCreateMock = vi.fn();
const runWriterAgentMock = vi.fn();
const buildSequenceStepsForEBMock = vi.fn();

vi.mock("@trigger.dev/sdk", () => ({
  task: (config: unknown) => config,
}));

vi.mock("@/lib/workspaces", () => ({
  getClientForWorkspace: vi.fn(async () => ({
    ensureCustomVariables: (...args: unknown[]) => ensureCustomVariablesMock(...args),
    createLead: (...args: unknown[]) => createLeadMock(...args),
    attachLeadsToCampaign: (...args: unknown[]) => attachLeadsToCampaignMock(...args),
    createCampaign: (...args: unknown[]) => createCampaignMock(...args),
    createSequenceSteps: (...args: unknown[]) => createSequenceStepsMock(...args),
  })),
}));

vi.mock("@/lib/notifications", () => ({
  notifyOooReengaged: vi.fn(),
}));

vi.mock("@/lib/agents/writer", () => ({
  runWriterAgent: (...args: unknown[]) => runWriterAgentMock(...args),
}));

vi.mock("@/lib/channels/email-adapter", () => ({
  buildSequenceStepsForEB: (...args: unknown[]) =>
    buildSequenceStepsForEBMock(...args),
}));

vi.mock("./../../trigger/queues", () => ({
  emailBisonQueue: "email-bison",
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    oooReengagement = {
      findFirst: (...args: unknown[]) => findPendingRecordMock(...args),
      update: (...args: unknown[]) => updateReengagementMock(...args),
    };
    person = {
      findFirst: (...args: unknown[]) => findPersonMock(...args),
      updateMany: (...args: unknown[]) => updatePeopleMock(...args),
    };
    campaign = {
      findFirst: (...args: unknown[]) => findCampaignMock(...args),
      create: (...args: unknown[]) => campaignCreateMock(...args),
    };
    workspace = {
      findUnique: (...args: unknown[]) => findWorkspaceMock(...args),
    };
  },
}));

describe("ooo-reengage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findPendingRecordMock.mockResolvedValue({
      id: "re-1",
      status: "pending",
      personEmail: "person@example.com",
      workspaceSlug: "acme",
      ebLeadId: 123,
      originalCampaignId: null,
    });
    findWorkspaceMock.mockResolvedValue({ name: "Acme" });
    findCampaignMock.mockResolvedValue({
      id: "camp-ooo",
      workspaceSlug: "acme",
      type: "ooo_reengage",
      emailBisonCampaignId: 99,
    });
    findPersonMock.mockResolvedValue({
      firstName: "Jamie",
      lastName: "Lee",
      jobTitle: "COO",
      companyDomain: "acme.com",
    });
    ensureCustomVariablesMock.mockResolvedValue(undefined);
    createLeadMock.mockRejectedValue(new Error("upsert failed"));
    createCampaignMock.mockResolvedValue({ id: 999 });
    createSequenceStepsMock.mockResolvedValue([]);
    campaignCreateMock.mockResolvedValue({ id: "camp-local" });
    runWriterAgentMock.mockResolvedValue({
      emailSteps: [
        { position: 1, subjectLine: "Welcome back", body: "b1", delayDays: 0 },
        { position: 2, subjectLine: "", body: "b2", delayDays: 3 },
        { position: 3, subjectLine: "Final", body: "b3", delayDays: 7 },
      ],
    });
    buildSequenceStepsForEBMock.mockReturnValue([
      {
        position: 1,
        subject: "Welcome back",
        body: "b1",
        delay_days: 3,
        thread_reply: false,
      },
      {
        position: 2,
        subject: "Welcome back",
        body: "b2",
        delay_days: 4,
        thread_reply: true,
      },
      {
        position: 3,
        subject: "Final",
        body: "b3",
        delay_days: 0,
        thread_reply: false,
      },
    ]);
  });

  it("throws after marking the record failed when the OOO greeting upsert fails", async () => {
    const { oooReengage } = await import("../../trigger/ooo-reengage");

    await expect((oooReengage as unknown as {
      run: (payload: unknown) => Promise<unknown>;
    }).run({
      personEmail: "person@example.com",
      workspaceSlug: "acme",
      oooReason: "holiday",
      eventName: null,
      originalCampaignId: null,
      ebLeadId: 123,
      reengagementId: "re-1",
    })).rejects.toThrow(/OOO greeting upsert failed: upsert failed/i);
    expect(attachLeadsToCampaignMock).not.toHaveBeenCalled();
    expect(findPendingRecordMock).toHaveBeenCalledWith({
      where: {
        id: "re-1",
        personEmail: "person@example.com",
        workspaceSlug: "acme",
        status: { in: ["pending", "failed"] },
      },
    });
    expect(updateReengagementMock).toHaveBeenCalledWith({
      where: { id: "re-1" },
      data: {
        status: "failed",
        failureReason: "OOO greeting upsert failed: upsert failed",
      },
    });
  });

  it("routes new OOO re-engagement campaigns through buildSequenceStepsForEB before createSequenceSteps", async () => {
    findCampaignMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    createLeadMock.mockResolvedValue({ id: 123 });

    const { oooReengage } = await import("../../trigger/ooo-reengage");

    await expect(
      (oooReengage as unknown as {
        run: (payload: unknown) => Promise<unknown>;
      }).run({
        personEmail: "person@example.com",
        workspaceSlug: "acme",
        oooReason: "holiday",
        eventName: null,
        originalCampaignId: null,
        ebLeadId: 123,
        reengagementId: "re-1",
      }),
    ).resolves.toMatchObject({ success: true });

    expect(buildSequenceStepsForEBMock).toHaveBeenCalledWith(
      [
        { position: 1, subjectLine: "Welcome back", body: "b1", delayDays: 0 },
        { position: 2, subjectLine: "", body: "b2", delayDays: 3 },
        { position: 3, subjectLine: "Final", body: "b3", delayDays: 7 },
      ],
      "OOO re-engage Re-engage: Acme OOO Returns",
    );
    expect(createSequenceStepsMock).toHaveBeenCalledWith(
      999,
      "Re-engage: Acme OOO Returns",
      buildSequenceStepsForEBMock.mock.results[0]?.value,
    );
  });
});
