import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  workspaceFindManyMock,
  senderFindManyMock,
  campaignFindFirstMock,
  auditLogCreateMock,
  progressWarmupMock,
  updateAcceptanceRateMock,
  activateSenderMock,
  recoverStuckActionsMock,
  expireStaleActionsMock,
  generateInsightsMock,
  notifyWeeklyDigestCombinedMock,
  notifyWeeklyDigestMock,
} = vi.hoisted(() => ({
  workspaceFindManyMock: vi.fn(),
  senderFindManyMock: vi.fn(),
  campaignFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  progressWarmupMock: vi.fn(),
  updateAcceptanceRateMock: vi.fn(),
  activateSenderMock: vi.fn(),
  recoverStuckActionsMock: vi.fn(),
  expireStaleActionsMock: vi.fn(),
  generateInsightsMock: vi.fn(),
  notifyWeeklyDigestCombinedMock: vi.fn(),
  notifyWeeklyDigestMock: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  schedules: {
    task: (config: unknown) => config,
  },
}));

vi.mock("./../../trigger/queues", () => ({
  anthropicQueue: "anthropic",
}));

vi.mock("@prisma/client", () => ({
  PrismaClient: class {
    workspace = {
      findMany: (...args: unknown[]) => workspaceFindManyMock(...args),
    };
    sender = {
      findMany: (...args: unknown[]) => senderFindManyMock(...args),
    };
    campaign = {
      findFirst: (...args: unknown[]) => campaignFindFirstMock(...args),
    };
    auditLog = {
      create: (...args: unknown[]) => auditLogCreateMock(...args),
    };
  },
}));

vi.mock("@/lib/insights/generate", () => ({
  generateInsights: (...args: unknown[]) => generateInsightsMock(...args),
}));

vi.mock("@/lib/notifications", () => ({
  notifyWeeklyDigest: (...args: unknown[]) => notifyWeeklyDigestMock(...args),
  notifyWeeklyDigestCombined: (...args: unknown[]) =>
    notifyWeeklyDigestCombinedMock(...args),
}));

vi.mock("@/lib/linkedin/rate-limiter", () => ({
  progressWarmup: (...args: unknown[]) => progressWarmupMock(...args),
}));

vi.mock("@/lib/linkedin/sender", () => ({
  updateAcceptanceRate: (...args: unknown[]) => updateAcceptanceRateMock(...args),
  activateSender: (...args: unknown[]) => activateSenderMock(...args),
}));

vi.mock("@/lib/linkedin/queue", () => ({
  recoverStuckActions: (...args: unknown[]) => recoverStuckActionsMock(...args),
  expireStaleActions: (...args: unknown[]) => expireStaleActionsMock(...args),
}));

describe("generate-insights task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T09:00:00.000Z"));

    workspaceFindManyMock.mockResolvedValue([]);
    senderFindManyMock
      .mockResolvedValueOnce([
        { id: "sender-setup", name: "Daniel Lazarus", workspaceSlug: "1210" },
      ])
      .mockResolvedValueOnce([
        { id: "sender-active", name: "Daniel Lazarus" },
      ]);
    campaignFindFirstMock.mockResolvedValue({ id: "campaign-1" });
    activateSenderMock.mockResolvedValue(undefined);
    auditLogCreateMock.mockResolvedValue(undefined);
    progressWarmupMock.mockResolvedValue(undefined);
    updateAcceptanceRateMock.mockResolvedValue(0.25);
    recoverStuckActionsMock.mockResolvedValue(0);
    expireStaleActionsMock.mockResolvedValue(0);
    generateInsightsMock.mockResolvedValue(0);
    notifyWeeklyDigestMock.mockResolvedValue(undefined);
    notifyWeeklyDigestCombinedMock.mockResolvedValue(undefined);
  });

  it("limits warmup auto-start and progression queries to LinkedIn-capable senders", async () => {
    const { generateInsightsTask } = await import("../../trigger/generate-insights");

    await (generateInsightsTask as unknown as { run: () => Promise<unknown> }).run();

    expect(senderFindManyMock).toHaveBeenNthCalledWith(1, {
      where: {
        warmupDay: 0,
        status: "setup",
        channel: { in: ["linkedin", "both"] },
        sessionStatus: "active",
      },
      select: { id: true, name: true, workspaceSlug: true },
    });

    expect(senderFindManyMock).toHaveBeenNthCalledWith(2, {
      where: {
        status: "active",
        channel: { in: ["linkedin", "both"] },
      },
      select: { id: true, name: true },
    });

    expect(progressWarmupMock).toHaveBeenCalledWith("sender-active", {
      source: "cron",
    });
    expect(updateAcceptanceRateMock).toHaveBeenCalledWith("sender-active");
  });
});
