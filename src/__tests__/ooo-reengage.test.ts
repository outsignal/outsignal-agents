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

vi.mock("@trigger.dev/sdk", () => ({
  task: (config: unknown) => config,
}));

vi.mock("@/lib/workspaces", () => ({
  getClientForWorkspace: vi.fn(async () => ({
    ensureCustomVariables: (...args: unknown[]) => ensureCustomVariablesMock(...args),
    createLead: (...args: unknown[]) => createLeadMock(...args),
    attachLeadsToCampaign: (...args: unknown[]) => attachLeadsToCampaignMock(...args),
  })),
}));

vi.mock("@/lib/notifications", () => ({
  notifyOooReengaged: vi.fn(),
}));

vi.mock("@/lib/agents/writer", () => ({
  runWriterAgent: vi.fn(),
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
});
