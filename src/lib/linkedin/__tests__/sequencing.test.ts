import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyRulesMock = vi.fn();
const findCampaignMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    campaignSequenceRule: {
      findMany: (...args: unknown[]) => findManyRulesMock(...args),
    },
    campaign: {
      findUnique: (...args: unknown[]) => findCampaignMock(...args),
    },
    linkedInConnection: {
      findFirst: vi.fn(),
    },
    reply: {
      findFirst: vi.fn(),
    },
    person: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/notify", () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}));

describe("evaluateSequenceRules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findCampaignMock.mockResolvedValue({ description: null });
  });

  it("alerts ops and skips the action when template rendering fails", async () => {
    findManyRulesMock.mockResolvedValue([
      {
        id: "rule-1",
        position: 1,
        variantKey: null,
        variantWeight: 1,
        conditionType: null,
        requireConnected: false,
        actionType: "message",
        messageTemplate: "Hey {{#if firstName}",
        delayMinutes: 15,
        elseActionType: null,
        elseMessageTemplate: null,
        elseDelayMinutes: null,
      },
    ]);

    const { evaluateSequenceRules } = await import("../sequencing");
    const result = await evaluateSequenceRules({
      workspaceSlug: "acme",
      campaignName: "Lime LI",
      triggerEvent: "connection_accepted",
      personId: "person-1",
      person: {
        firstName: "Jordan",
        lastName: "Lee",
        company: "Acme Ltd",
        jobTitle: "COO",
        linkedinUrl: "https://linkedin.com/in/jordan",
        email: "jordan@acme.example",
      },
    });

    expect(result).toEqual([]);
    expect(notifyMock).toHaveBeenCalledWith({
      type: "error",
      severity: "error",
      title: "LinkedIn sequence rule skipped due to template failure",
      message: expect.stringContaining("Rule: rule-1"),
      workspaceSlug: "acme",
      metadata: expect.objectContaining({
        campaignName: "Lime LI",
        ruleId: "rule-1",
        personId: "person-1",
        triggerEvent: "connection_accepted",
        actionType: "message",
        path: "primary",
      }),
    });
  });
});
