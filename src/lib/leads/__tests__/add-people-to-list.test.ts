import { beforeEach, describe, expect, it, vi } from "vitest";

const targetListFindUniqueMock = vi.fn();
const campaignFindFirstMock = vi.fn();
const personFindManyMock = vi.fn();
const targetListPersonCountMock = vi.fn();
const targetListPersonCreateManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    targetList: {
      findUnique: (...args: unknown[]) => targetListFindUniqueMock(...args),
    },
    campaign: {
      findFirst: (...args: unknown[]) => campaignFindFirstMock(...args),
    },
    person: {
      findMany: (...args: unknown[]) => personFindManyMock(...args),
    },
    targetListPerson: {
      count: (...args: unknown[]) => targetListPersonCountMock(...args),
      createMany: (...args: unknown[]) => targetListPersonCreateManyMock(...args),
    },
  },
}));

const detectOverlapsMock = vi.fn();
vi.mock("@/lib/campaigns/overlap-detection", () => ({
  detectOverlaps: (...args: unknown[]) => detectOverlapsMock(...args),
}));

vi.mock("@/lib/exclusions", () => ({
  getExclusionDomains: vi.fn().mockResolvedValue(new Set()),
  getExclusionEmails: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock("@/lib/channels/validation", () => ({
  filterPeopleForChannels: vi.fn((_people: unknown[], _channels: string[]) => ({
    valid: [
      { id: "person-1", email: "one@acme.com", linkedinUrl: null },
      { id: "person-2", email: "two@acme.com", linkedinUrl: null },
    ],
    rejected: [],
  })),
}));

vi.mock("@/lib/validation/channel-gate", () => ({
  validatePeopleForChannel: vi.fn().mockResolvedValue({
    valid: true,
    accepted: ["person-1", "person-2"],
    rejected: [],
  }),
}));

vi.mock("@/lib/icp/scorer", () => ({ scorePersonIcp: vi.fn() }));
vi.mock("@/lib/export/verification-gate", () => ({ getListExportReadiness: vi.fn() }));
vi.mock("@/lib/workspaces", () => ({ getClientForWorkspace: vi.fn() }));

import { addPeopleToList } from "../operations";

describe("addPeopleToList overlap gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    targetListFindUniqueMock.mockResolvedValue({ workspaceSlug: "ws-1" });
    campaignFindFirstMock.mockResolvedValue({
      id: "campaign-1",
      channels: "[\"email\"]",
    });
    personFindManyMock.mockResolvedValue([
      { id: "person-1", email: "one@acme.com", linkedinUrl: null },
      { id: "person-2", email: "two@acme.com", linkedinUrl: null },
    ]);
    targetListPersonCountMock.mockResolvedValue(0);
    targetListPersonCreateManyMock.mockResolvedValue({ count: 1 });
  });

  it("rejects people already present in another active or recently completed campaign", async () => {
    detectOverlapsMock.mockResolvedValue([
      {
        personId: "person-2",
        overlappingCampaignId: "campaign-2",
        overlappingCampaignName: "Sibling Campaign",
        overlapField: "email",
      },
    ]);

    const result = await addPeopleToList("list-1", ["person-1", "person-2"]);

    expect(detectOverlapsMock).toHaveBeenCalledWith({
      workspaceSlug: "ws-1",
      candidatePersonIds: ["person-1", "person-2"],
      excludeCampaignId: "campaign-1",
    });
    expect(targetListPersonCreateManyMock).toHaveBeenCalledWith({
      data: [{ listId: "list-1", personId: "person-1" }],
      skipDuplicates: true,
    });
    expect(result).toMatchObject({
      added: 1,
      alreadyInList: 0,
      rejected: 1,
    });
    expect(result.rejectionSummary).toContain("Sibling Campaign");
  });
});
