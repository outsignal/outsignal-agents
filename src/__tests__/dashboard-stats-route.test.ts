import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdminAuthMock,
  getWorkspaceBySlugMock,
  getCanonicalLinkedInSenderMock,
  senderFindManyMock,
  senderFindFirstMock,
  senderGroupByMock,
  workspaceFindManyMock,
  webhookEventGroupByMock,
  webhookEventFindManyMock,
  linkedInDailyUsageFindManyMock,
  personWorkspaceGroupByMock,
  campaignGroupByMock,
  replyCountMock,
  replyFindManyMock,
  replyGroupByMock,
  agentRunFindManyMock,
} = vi.hoisted(() => ({
  requireAdminAuthMock: vi.fn(),
  getWorkspaceBySlugMock: vi.fn(),
  getCanonicalLinkedInSenderMock: vi.fn(),
  senderFindManyMock: vi.fn(),
  senderFindFirstMock: vi.fn(),
  senderGroupByMock: vi.fn(),
  workspaceFindManyMock: vi.fn(),
  webhookEventGroupByMock: vi.fn(),
  webhookEventFindManyMock: vi.fn(),
  linkedInDailyUsageFindManyMock: vi.fn(),
  personWorkspaceGroupByMock: vi.fn(),
  campaignGroupByMock: vi.fn(),
  replyCountMock: vi.fn(),
  replyFindManyMock: vi.fn(),
  replyGroupByMock: vi.fn(),
  agentRunFindManyMock: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      json: async () => body,
      status: init?.status ?? 200,
    }),
  },
  NextRequest: class extends Request {
    nextUrl: URL;

    constructor(input: string | URL, init?: RequestInit) {
      super(input, init);
      this.nextUrl = new URL(typeof input === "string" ? input : input.toString());
    }
  },
}));

vi.mock("@/lib/require-admin-auth", () => ({
  requireAdminAuth: (...args: unknown[]) => requireAdminAuthMock(...args),
}));

vi.mock("@/lib/workspaces", () => ({
  getWorkspaceBySlug: (...args: unknown[]) => getWorkspaceBySlugMock(...args),
}));

vi.mock("@/lib/linkedin/sender", () => ({
  getCanonicalLinkedInSender: (...args: unknown[]) =>
    getCanonicalLinkedInSenderMock(...args),
}));

vi.mock("@/lib/emailbison/client", () => ({
  EmailBisonClient: class {
    async getWorkspaceStats() {
      return { emails_sent: "0" };
    }

    async getSenderEmails() {
      return [];
    }
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    sender: {
      findMany: (...args: unknown[]) => senderFindManyMock(...args),
      findFirst: (...args: unknown[]) => senderFindFirstMock(...args),
      groupBy: (...args: unknown[]) => senderGroupByMock(...args),
    },
    workspace: {
      findMany: (...args: unknown[]) => workspaceFindManyMock(...args),
    },
    webhookEvent: {
      groupBy: (...args: unknown[]) => webhookEventGroupByMock(...args),
      findMany: (...args: unknown[]) => webhookEventFindManyMock(...args),
    },
    linkedInDailyUsage: {
      findMany: (...args: unknown[]) => linkedInDailyUsageFindManyMock(...args),
    },
    personWorkspace: {
      groupBy: (...args: unknown[]) => personWorkspaceGroupByMock(...args),
    },
    campaign: {
      groupBy: (...args: unknown[]) => campaignGroupByMock(...args),
    },
    reply: {
      count: (...args: unknown[]) => replyCountMock(...args),
      findMany: (...args: unknown[]) => replyFindManyMock(...args),
      groupBy: (...args: unknown[]) => replyGroupByMock(...args),
    },
    agentRun: {
      findMany: (...args: unknown[]) => agentRunFindManyMock(...args),
    },
  },
}));

describe("GET /api/dashboard/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T12:00:00.000Z"));

    requireAdminAuthMock.mockResolvedValue({
      email: "admin@getoutsignal.com",
      role: "admin",
      exp: Infinity,
    });
    getWorkspaceBySlugMock.mockResolvedValue(null);
    getCanonicalLinkedInSenderMock.mockResolvedValue({
      id: "sender-1",
      lastPolledAt: new Date("2026-04-21T11:55:00.000Z"),
    });

    senderFindManyMock
      .mockResolvedValueOnce([{ id: "sender-1" }])
      .mockResolvedValueOnce([{ sessionStatus: "active" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    senderFindFirstMock.mockResolvedValue(null);
    senderGroupByMock.mockResolvedValue([]);
    workspaceFindManyMock.mockResolvedValue([
      {
        slug: "rise",
        name: "Rise",
        apiToken: null,
        status: "active",
        package: "linkedin",
        _count: { senders: 1 },
      },
    ]);
    webhookEventGroupByMock.mockResolvedValue([]);
    webhookEventFindManyMock.mockResolvedValue([]);
    linkedInDailyUsageFindManyMock.mockResolvedValue([]);
    personWorkspaceGroupByMock.mockResolvedValue([]);
    campaignGroupByMock.mockResolvedValue([]);
    replyCountMock.mockResolvedValue(0);
    replyFindManyMock.mockResolvedValue([]);
    replyGroupByMock.mockResolvedValue([]);
    agentRunFindManyMock.mockResolvedValue([]);
  });

  it("uses the canonical LinkedIn sender helper for workspace-specific worker heartbeat", async () => {
    const { GET } = await import("@/app/api/dashboard/stats/route");
    const request = new Request(
      "http://localhost/api/dashboard/stats?workspace=rise",
    ) as unknown as import("next/server").NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(getCanonicalLinkedInSenderMock).toHaveBeenCalledWith("rise");
    expect(senderFindFirstMock).not.toHaveBeenCalled();
    expect(body.kpis.workerStatus).toBe("online");
    expect(body.kpis.workerLastPollAt).toBe("2026-04-21T11:55:00.000Z");
  });
});
