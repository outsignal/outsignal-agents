/**
 * Shared adapter contract test suite.
 *
 * Both LinkedIn and Email adapters must pass the same set of interface
 * conformance tests. The `runAdapterContractTests` factory is called
 * once per adapter — if a future adapter is added it runs the same tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Prisma — must come before adapter imports
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  prisma: {
    linkedInAction: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    person: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    reply: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    campaignSequenceRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    campaign: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    workspace: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ apiToken: "test-token" }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock EmailBisonClient — must come before adapter imports
// ---------------------------------------------------------------------------

const mockGetCampaignById = vi.fn().mockResolvedValue(null);
const mockGetCampaignLeads = vi.fn().mockResolvedValue({ data: [] });
const mockGetSequenceSteps = vi.fn().mockResolvedValue([]);
const mockPauseCampaign = vi.fn().mockResolvedValue({});
const mockResumeCampaign = vi.fn().mockResolvedValue({});

vi.mock("@/lib/emailbison/client", () => {
  return {
    EmailBisonClient: class MockEmailBisonClient {
      getCampaignById = mockGetCampaignById;
      getCampaignLeads = mockGetCampaignLeads;
      getSequenceSteps = mockGetSequenceSteps;
      pauseCampaign = mockPauseCampaign;
      resumeCampaign = mockResumeCampaign;
    },
  };
});

// ---------------------------------------------------------------------------
// Imports — after mocks
// ---------------------------------------------------------------------------

import { LinkedInAdapter } from "../linkedin-adapter";
import { EmailAdapter } from "../email-adapter";
import { CHANNEL_TYPES } from "../constants";
import type { ChannelType } from "../constants";
import type {
  ChannelAdapter,
  CampaignChannelRef,
  UnifiedMetrics,
  UnifiedLead,
  UnifiedAction,
  UnifiedStep,
} from "../types";

// ---------------------------------------------------------------------------
// Shared contract test factory
// ---------------------------------------------------------------------------

function runAdapterContractTests(
  name: string,
  createAdapter: () => ChannelAdapter,
  expectedChannel: ChannelType,
  refOverrides: Partial<CampaignChannelRef> = {},
) {
  describe(`${name} adapter contract`, () => {
    let adapter: ChannelAdapter;
    const ref: CampaignChannelRef = {
      campaignId: "test-campaign-id",
      workspaceSlug: "test-workspace",
      campaignName: "Test Campaign",
      ...refOverrides,
    };

    beforeEach(() => {
      adapter = createAdapter();
    });

    it("has a readonly channel property matching expected type", () => {
      expect(adapter.channel).toBe(expectedChannel);
    });

    it("deploy() rejects with Phase 73 message", async () => {
      await expect(
        adapter.deploy({
          deployId: "d1",
          campaignId: "c1",
          campaignName: "Test",
          workspaceSlug: "test",
          sequence: [],
        }),
      ).rejects.toThrow("Phase 73");
    });

    it("getMetrics() returns UnifiedMetrics with required fields", async () => {
      const metrics: UnifiedMetrics = await adapter.getMetrics(ref);
      expect(metrics).toHaveProperty("channel");
      expect(metrics).toHaveProperty("sent");
      expect(metrics).toHaveProperty("replied");
      expect(metrics).toHaveProperty("replyRate");
      expect(typeof metrics.sent).toBe("number");
      expect(typeof metrics.replied).toBe("number");
      expect(typeof metrics.replyRate).toBe("number");
    });

    it("getLeads() returns UnifiedLead array", async () => {
      const leads: UnifiedLead[] = await adapter.getLeads(ref);
      expect(Array.isArray(leads)).toBe(true);
    });

    it("getActions() returns UnifiedAction array", async () => {
      const actions: UnifiedAction[] = await adapter.getActions(ref);
      expect(Array.isArray(actions)).toBe(true);
    });

    it("getSequenceSteps() returns UnifiedStep array", async () => {
      const steps: UnifiedStep[] = await adapter.getSequenceSteps(ref);
      expect(Array.isArray(steps)).toBe(true);
    });

    it("pause() does not throw", async () => {
      await expect(adapter.pause(ref)).resolves.toBeUndefined();
    });

    it("resume() does not throw", async () => {
      await expect(adapter.resume(ref)).resolves.toBeUndefined();
    });
  });
}

// ---------------------------------------------------------------------------
// Run contract tests for both adapters
// ---------------------------------------------------------------------------

runAdapterContractTests(
  "LinkedIn",
  () => new LinkedInAdapter(),
  CHANNEL_TYPES.LINKEDIN,
);

runAdapterContractTests(
  "Email",
  () => new EmailAdapter(),
  CHANNEL_TYPES.EMAIL,
  { emailBisonCampaignId: 123 },
);
