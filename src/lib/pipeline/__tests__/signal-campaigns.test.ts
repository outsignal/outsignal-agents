import { beforeEach, describe, expect, it, vi } from "vitest";

const notifyMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/notify", () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}));

const apolloSearchMock = vi.fn();
vi.mock("@/lib/discovery/adapters/apollo", () => ({
  apolloAdapter: {
    search: (...args: unknown[]) => apolloSearchMock(...args),
  },
}));

const stageDiscoveredPeopleMock = vi.fn();
vi.mock("@/lib/discovery/staging", () => ({
  stageDiscoveredPeople: (...args: unknown[]) => stageDiscoveredPeopleMock(...args),
}));

const deduplicateAndPromoteMock = vi.fn();
vi.mock("@/lib/discovery/promotion", () => ({
  deduplicateAndPromote: (...args: unknown[]) => deduplicateAndPromoteMock(...args),
}));

vi.mock("@/lib/icp/scorer", () => ({
  scorePersonIcp: vi.fn(),
}));

const resolveIcpContextForWorkspaceSlugMock = vi.fn();
vi.mock("@/lib/icp/resolver", () => ({
  resolveIcpContextForWorkspaceSlug: (...args: unknown[]) =>
    resolveIcpContextForWorkspaceSlugMock(...args),
}));

vi.mock("@/lib/leads/operations", () => ({
  addPeopleToList: vi.fn(),
}));

vi.mock("@/lib/emailbison/client", () => ({
  EmailBisonClient: class MockEmailBisonClient {},
}));

vi.mock("@/lib/emailbison/custom-variable-names", () => ({
  EMAILBISON_STANDARD_SEQUENCE_CUSTOM_VARIABLES: [],
}));

vi.mock("@/lib/emailbison/lead-payload", () => ({
  buildEmailLeadPayload: vi.fn(),
}));

vi.mock("@/lib/linkedin/chain", () => ({
  chainActions: vi.fn(),
}));

vi.mock("@/lib/linkedin/jitter", () => ({
  applyTimingJitter: vi.fn((ms: number) => ms),
}));

vi.mock("@/lib/linkedin/sequencing", () => ({
  createSequenceRulesForCampaign: vi.fn(),
}));

vi.mock("@/lib/linkedin/sender", () => ({
  assignSenderForPerson: vi.fn(),
}));

vi.mock("@/lib/slack", () => ({
  postMessage: vi.fn(),
}));

vi.mock("@/lib/enrichment/credit-exhaustion", () => ({
  isCreditExhaustion: vi.fn(() => false),
}));

const campaignFindManyMock = vi.fn();
const campaignUpdateMock = vi.fn();
const signalCampaignLeadCountMock = vi.fn();
const signalCampaignLeadFindManyMock = vi.fn();
const signalEventFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: {
      findMany: (...args: unknown[]) => campaignFindManyMock(...args),
      update: (...args: unknown[]) => campaignUpdateMock(...args),
    },
    signalCampaignLead: {
      count: (...args: unknown[]) => signalCampaignLeadCountMock(...args),
      findMany: (...args: unknown[]) => signalCampaignLeadFindManyMock(...args),
    },
    signalEvent: {
      findMany: (...args: unknown[]) => signalEventFindManyMock(...args),
    },
    person: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const baseCampaign = {
  id: "sig-1",
  name: "Apollo Signals",
  workspaceSlug: "lime",
  status: "active",
  type: "signal",
  signalTypes: JSON.stringify(["funding"]),
  icpCriteria: JSON.stringify({ titles: ["CEO"] }),
  dailyLeadCap: 20,
  icpScoreThreshold: 70,
  lastSignalProcessedAt: null,
  targetListId: "list-1",
  channels: JSON.stringify(["linkedin"]),
  linkedinSequence: JSON.stringify([]),
  signalEmailBisonCampaignId: null,
  workspace: {
    apiToken: "token-1",
    slackChannelId: null,
    name: "Lime",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveIcpContextForWorkspaceSlugMock.mockResolvedValue({
    workspaceId: "ws-lime",
    source: "legacy",
    profileId: null,
    versionId: null,
    snapshot: {
      description: "Legacy ICP",
      targetTitles: null,
      locations: null,
      industries: null,
      companySizes: null,
      scoringRubric: null,
    },
    warnings: [],
  });
  campaignFindManyMock.mockResolvedValue([baseCampaign]);
  signalCampaignLeadCountMock.mockResolvedValue(0);
  signalEventFindManyMock.mockResolvedValue([
    { id: "signal-1", companyDomain: "acme.com", signalType: "funding" },
  ]);
  signalCampaignLeadFindManyMock.mockResolvedValue([]);
});

describe("processSignalCampaigns", () => {
  it("does not mark signals processed when the discovery vendor is unavailable", async () => {
    apolloSearchMock.mockRejectedValue(new Error("Apollo disabled"));

    const { processSignalCampaigns } = await import(
      "@/lib/pipeline/signal-campaigns"
    );
    const result = await processSignalCampaigns();

    expect(notifyMock).toHaveBeenCalledWith({
      type: "system",
      severity: "warning",
      title: "Signal campaign discovery skipped",
      workspaceSlug: "lime",
      message:
        'Signal campaign "Apollo Signals" could not run discovery because the vendor was unavailable: Apollo disabled',
      metadata: {
        campaignId: "sig-1",
        campaignName: "Apollo Signals",
        adapter: "apollo",
        source: "signal_campaigns",
      },
    });
    expect(campaignUpdateMock).not.toHaveBeenCalled();
    expect(deduplicateAndPromoteMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      campaignsProcessed: 1,
      totalLeadsAdded: 0,
      totalSignalsMatched: 1,
      errors: [],
    });
  });

  it("threads campaignId into promotion so LinkedIn-only signal campaigns can skip email enrichment", async () => {
    apolloSearchMock.mockResolvedValue({
      people: [{ id: "apollo-1" }],
      rawResponse: { people: [] },
    });
    stageDiscoveredPeopleMock.mockResolvedValue({ runId: "run-1" });
    deduplicateAndPromoteMock.mockResolvedValue({ promotedIds: [] });

    const { processSignalCampaigns } = await import(
      "@/lib/pipeline/signal-campaigns"
    );
    const result = await processSignalCampaigns();

    expect(deduplicateAndPromoteMock).toHaveBeenCalledWith("lime", ["run-1"], {
      campaignId: "sig-1",
    });
    expect(campaignUpdateMock).toHaveBeenCalledWith({
      where: { id: "sig-1" },
      data: { lastSignalProcessedAt: expect.any(Date) },
    });
    expect(result).toEqual({
      campaignsProcessed: 1,
      totalLeadsAdded: 0,
      totalSignalsMatched: 1,
      errors: [],
    });
  });
});

describe("isVendorUnavailableError", () => {
  it("does not over-match message text that merely mentions 500 leads", async () => {
    const { isVendorUnavailableError } = await import(
      "@/lib/pipeline/signal-campaigns"
    );

    expect(
      isVendorUnavailableError(new Error("Failed to process 500 leads")),
    ).toBe(false);
  });

  it("does not over-match message text that merely mentions 502 records", async () => {
    const { isVendorUnavailableError } = await import(
      "@/lib/pipeline/signal-campaigns"
    );

    expect(
      isVendorUnavailableError(new Error("Processed 502 records successfully")),
    ).toBe(false);
  });

  it("treats a structured 500 status as vendor-unavailable", async () => {
    const { isVendorUnavailableError } = await import(
      "@/lib/pipeline/signal-campaigns"
    );

    expect(isVendorUnavailableError({ status: 500 })).toBe(true);
  });

  it("treats a structured 429 statusCode as vendor-unavailable", async () => {
    const { isVendorUnavailableError } = await import(
      "@/lib/pipeline/signal-campaigns"
    );

    expect(isVendorUnavailableError({ statusCode: 429 })).toBe(true);
  });

  it("treats structured network error codes as vendor-unavailable errors", async () => {
    const { isVendorUnavailableError } = await import(
      "@/lib/pipeline/signal-campaigns"
    );

    expect(isVendorUnavailableError({ code: "ECONNREFUSED" })).toBe(true);
  });

  it("treats nested network error codes as vendor-unavailable errors", async () => {
    const { isVendorUnavailableError } = await import(
      "@/lib/pipeline/signal-campaigns"
    );

    expect(isVendorUnavailableError({ cause: { code: "ENOTFOUND" } })).toBe(true);
  });

  it("treats SSL and certificate verification failures as vendor-unavailable errors", async () => {
    const { isVendorUnavailableError } = await import(
      "@/lib/pipeline/signal-campaigns"
    );

    expect(
      isVendorUnavailableError(new Error("SSL: certificate verify failed")),
    ).toBe(true);
  });

  it("treats the Apollo disabled marker as vendor-unavailable", async () => {
    const { isVendorUnavailableError } = await import(
      "@/lib/pipeline/signal-campaigns"
    );

    expect(isVendorUnavailableError(new Error("Apollo disabled"))).toBe(true);
  });
});
