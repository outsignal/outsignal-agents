import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  enqueueAction,
  getNextBatch,
  markComplete,
  markFailed,
  cancelAction,
  cancelActionsForPerson,
  bumpPriority,
  recoverStuckActions,
} from "@/lib/linkedin/queue";
import { checkBudget } from "@/lib/linkedin/rate-limiter";

// Mock the rate-limiter module
vi.mock("@/lib/linkedin/rate-limiter", () => ({
  checkBudget: vi.fn().mockResolvedValue({ allowed: true, remaining: 10 }),
  checkCircuitBreaker: vi.fn().mockResolvedValue({ tripped: false, consecutiveFailures: 0 }),
}));

const mockCheckBudget = vi.mocked(checkBudget);

describe("enqueueAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no dedup match
    (prisma.linkedInAction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it("creates a pending action with default priority 5", async () => {
    (prisma.linkedInAction.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
    });

    const id = await enqueueAction({
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "rise",
      actionType: "connect",
    });

    expect(id).toBe("action-1");
    expect(prisma.linkedInAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderId: "sender-1",
        personId: "person-1",
        workspaceSlug: "rise",
        actionType: "connect",
        priority: 5,
        status: "pending",
      }),
    });
  });

  it("creates a priority 1 action for warm leads", async () => {
    (prisma.linkedInAction.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-2",
    });

    await enqueueAction({
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "rise",
      actionType: "connect",
      priority: 1,
    });

    expect(prisma.linkedInAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        priority: 1,
      }),
    });
  });

  it("stores message body for message actions", async () => {
    (prisma.linkedInAction.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-3",
    });

    await enqueueAction({
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "rise",
      actionType: "message",
      messageBody: "Hey {{firstName}}, glad to connect!",
    });

    expect(prisma.linkedInAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionType: "message",
        messageBody: "Hey {{firstName}}, glad to connect!",
      }),
    });
  });

  it("stores campaign context", async () => {
    (prisma.linkedInAction.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-4",
    });

    await enqueueAction({
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "rise",
      actionType: "connect",
      campaignName: "Q1 Outbound",
      sequenceStepRef: "email_1",
    });

    expect(prisma.linkedInAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignName: "Q1 Outbound",
        sequenceStepRef: "email_1",
      }),
    });
  });
});

describe("markComplete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates action status to complete with timestamp", async () => {
    (prisma.linkedInAction.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      actionType: "profile_view",
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "rise",
      sequenceStepRef: null,
    });
    (prisma.linkedInAction.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await markComplete("action-1", '{"success":true}');

    expect(prisma.linkedInAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: {
        status: "complete",
        completedAt: expect.any(Date),
        result: '{"success":true}',
      },
    });
  });

  it("increments pending count on connection_request completion", async () => {
    (prisma.linkedInAction.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      actionType: "connection_request",
      senderId: "sender-1",
      personId: "person-1",
      workspaceSlug: "rise",
      sequenceStepRef: null,
    });
    (prisma.linkedInAction.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (prisma.sender.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await markComplete("action-1");

    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: {
        pendingConnectionCount: { increment: 1 },
        pendingCountUpdatedAt: expect.any(Date),
      },
    });
  });
});

describe("markFailed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks as failed when retries exhausted", async () => {
    (prisma.linkedInAction.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      attempts: 3,
      maxAttempts: 3,
    });
    (prisma.linkedInAction.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await markFailed("action-1", "Session expired");

    expect(prisma.linkedInAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: {
        status: "failed",
        result: JSON.stringify({ error: "Session expired" }),
      },
    });
  });

  it("schedules retry with backoff when attempts remain", async () => {
    (prisma.linkedInAction.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "action-1",
      attempts: 1,
      maxAttempts: 3,
    });
    (prisma.linkedInAction.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await markFailed("action-1", "Network error");

    expect(prisma.linkedInAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: expect.objectContaining({
        status: "pending", // back to pending for retry
        nextRetryAt: expect.any(Date),
        scheduledFor: expect.any(Date),
      }),
    });
  });
});

describe("cancelAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets status to cancelled", async () => {
    (prisma.linkedInAction.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await cancelAction("action-1");

    expect(prisma.linkedInAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: { status: "cancelled" },
    });
  });
});

describe("cancelActionsForPerson", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels all pending actions for a person in a workspace", async () => {
    (prisma.linkedInAction.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 2,
    });

    const count = await cancelActionsForPerson("person-1", "rise");

    expect(count).toBe(2);
    expect(prisma.linkedInAction.updateMany).toHaveBeenCalledWith({
      where: {
        personId: "person-1",
        workspaceSlug: "rise",
        status: "pending",
      },
      data: { status: "cancelled" },
    });
  });
});

describe("bumpPriority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bumps pending connect actions to priority 1", async () => {
    (prisma.linkedInAction.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    });

    const bumped = await bumpPriority("person-1", "rise");

    expect(bumped).toBe(true);
    expect(prisma.linkedInAction.updateMany).toHaveBeenCalledWith({
      where: {
        personId: "person-1",
        workspaceSlug: "rise",
        status: "pending",
        actionType: { in: ["connect", "connection_request"] },
      },
      data: {
        priority: 1,
        scheduledFor: expect.any(Date),
      },
    });
  });

  it("returns false when no pending connect action exists", async () => {
    (prisma.linkedInAction.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });

    const bumped = await bumpPriority("person-1", "rise");
    expect(bumped).toBe(false);
  });
});

describe("recoverStuckActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets stuck running actions to pending if retries remain", async () => {
    (prisma.linkedInAction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "action-1", attempts: 1, maxAttempts: 3 },
    ]);
    (prisma.linkedInAction.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const recovered = await recoverStuckActions();

    expect(recovered).toBe(1);
    expect(prisma.linkedInAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: {
        status: "pending",
        result: JSON.stringify({ error: "Worker crash recovery" }),
      },
    });
  });

  it("marks stuck actions as failed if retries exhausted", async () => {
    (prisma.linkedInAction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "action-2", attempts: 3, maxAttempts: 3 },
    ]);
    (prisma.linkedInAction.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await recoverStuckActions();

    expect(prisma.linkedInAction.update).toHaveBeenCalledWith({
      where: { id: "action-2" },
      data: {
        status: "failed",
        result: JSON.stringify({ error: "Worker crash recovery" }),
      },
    });
  });
});

describe("getNextBatch — independent per-type budgets", () => {

  const makeAction = (id: string, actionType: string, priority: number = 5) => ({
    id,
    personId: `person-${id}`,
    actionType,
    messageBody: null,
    priority,
    workspaceSlug: "test",
    campaignName: null,
    linkedInConversationId: null,
  });

  const mockFindMany = (
    connections: ReturnType<typeof makeAction>[],
    views: ReturnType<typeof makeAction>[],
    messages: ReturnType<typeof makeAction>[] = [],
  ) => {
    (prisma.linkedInAction.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      (args: { where: { actionType?: { in: string[] } } }) => {
        const types = args.where?.actionType?.in ?? [];
        if (types.includes("connect") || types.includes("connection_request")) {
          return Promise.resolve(connections);
        }
        if (types.includes("profile_view") || types.includes("check_connection")) {
          return Promise.resolve(views);
        }
        if (types.includes("message")) {
          return Promise.resolve(messages);
        }
        return Promise.resolve([]);
      },
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default budget mock after clearAllMocks wipes implementations
    mockCheckBudget.mockResolvedValue({ allowed: true, remaining: 10 });
  });

  it("returns actions from all types independently up to per-type limit", async () => {
    const connections = Array.from({ length: 10 }, (_, i) =>
      makeAction(`conn-${i}`, "connection_request"),
    );
    const views = Array.from({ length: 10 }, (_, i) =>
      makeAction(`view-${i}`, "profile_view"),
    );
    const messages = Array.from({ length: 10 }, (_, i) =>
      makeAction(`msg-${i}`, "message"),
    );

    mockFindMany(connections, views, messages);

    // perTypeLimit = 5: up to 5 of each type
    const batch = await getNextBatch("sender-1", 5);

    const connectionCount = batch.filter(
      (a) => a.actionType === "connection_request" || a.actionType === "connect",
    ).length;
    const viewCount = batch.filter(
      (a) => a.actionType === "profile_view" || a.actionType === "check_connection",
    ).length;
    const messageCount = batch.filter((a) => a.actionType === "message").length;

    expect(connectionCount).toBe(5);
    expect(viewCount).toBe(5);
    expect(messageCount).toBe(5);
    // Total = 15 (5 per type, 3 types)
    expect(batch.length).toBe(15);
  });

  it("each type gets its own budget check independently", async () => {
    const connections = Array.from({ length: 3 }, (_, i) =>
      makeAction(`conn-${i}`, "connection_request"),
    );
    const views = Array.from({ length: 3 }, (_, i) =>
      makeAction(`view-${i}`, "profile_view"),
    );
    const messages = Array.from({ length: 3 }, (_, i) =>
      makeAction(`msg-${i}`, "message"),
    );

    mockFindMany(connections, views, messages);

    const batch = await getNextBatch("sender-1", 5);

    // checkBudget should be called for each action across all 3 groups (9 total)
    expect(mockCheckBudget).toHaveBeenCalledTimes(9);
    // Verify it was called with the correct action types
    const callArgs = mockCheckBudget.mock.calls;
    const connectionBudgetCalls = callArgs.filter(
      (args) => args[1] === "connection_request",
    );
    const viewBudgetCalls = callArgs.filter(
      (args) => args[1] === "profile_view",
    );
    const messageBudgetCalls = callArgs.filter(
      (args) => args[1] === "message",
    );
    expect(connectionBudgetCalls.length).toBe(3);
    expect(viewBudgetCalls.length).toBe(3);
    expect(messageBudgetCalls.length).toBe(3);
  });

  it("returns empty for a type when its budget is exhausted without affecting other types", async () => {
    const connections = Array.from({ length: 5 }, (_, i) =>
      makeAction(`conn-${i}`, "connection_request"),
    );
    const views = Array.from({ length: 5 }, (_, i) =>
      makeAction(`view-${i}`, "profile_view"),
    );
    const messages = Array.from({ length: 5 }, (_, i) =>
      makeAction(`msg-${i}`, "message"),
    );

    mockFindMany(connections, views, messages);

    // Connection budget exhausted, views and messages still allowed
    mockCheckBudget.mockImplementation(
      (_senderId: string, actionType: string) => {
        if (actionType === "connection_request") {
          return Promise.resolve({ allowed: false, remaining: 0, reason: "Daily connection limit reached" });
        }
        return Promise.resolve({ allowed: true, remaining: 10 });
      },
    );

    const batch = await getNextBatch("sender-1", 5);

    const connectionCount = batch.filter(
      (a) => a.actionType === "connection_request",
    ).length;
    const viewCount = batch.filter(
      (a) => a.actionType === "profile_view",
    ).length;
    const messageCount = batch.filter((a) => a.actionType === "message").length;

    // Connections blocked, but views and messages unaffected
    expect(connectionCount).toBe(0);
    expect(viewCount).toBe(5);
    expect(messageCount).toBe(5);
    expect(batch.length).toBe(10);
  });

  it("connection_requests are not starved when many profile_views are pending", async () => {
    const connections = Array.from({ length: 5 }, (_, i) =>
      makeAction(`conn-${i}`, "connection_request"),
    );
    const views = Array.from({ length: 200 }, (_, i) =>
      makeAction(`view-${i}`, "profile_view"),
    );

    mockFindMany(connections, views);

    const batch = await getNextBatch("sender-1", 5);

    const connectionCount = batch.filter(
      (a) => a.actionType === "connection_request",
    ).length;

    // All 5 connections included — views don't compete with them
    expect(connectionCount).toBe(5);
  });

  it("returns only available actions when fewer than perTypeLimit exist", async () => {
    // Only 2 views pending, no connections or messages
    const views = Array.from({ length: 2 }, (_, i) =>
      makeAction(`view-${i}`, "profile_view"),
    );

    mockFindMany([], views, []);

    const batch = await getNextBatch("sender-1", 5);

    expect(batch.length).toBe(2);
    expect(batch.every((a) => a.actionType === "profile_view")).toBe(true);
  });

  it("sorts merged results by priority", async () => {
    const connections = [makeAction("conn-0", "connection_request", 1)];
    const views = [makeAction("view-0", "profile_view", 5)];
    const messages = [makeAction("msg-0", "message", 3)];

    mockFindMany(connections, views, messages);

    const batch = await getNextBatch("sender-1", 5);

    expect(batch.length).toBe(3);
    expect(batch[0].priority).toBe(1); // connection_request (priority 1)
    expect(batch[1].priority).toBe(3); // message (priority 3)
    expect(batch[2].priority).toBe(5); // profile_view (priority 5)
  });

  it("includes withdraw_connection actions in their own pool", async () => {
    // Set up findMany to return withdrawal actions for the WITHDRAWAL_TYPES query
    (prisma.linkedInAction.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      (args: { where: { actionType?: { in: string[] } } }) => {
        const types = args.where?.actionType?.in ?? [];
        if (types.includes("withdraw_connection")) {
          return Promise.resolve([
            makeAction("withdraw-0", "withdraw_connection", 2),
            makeAction("withdraw-1", "withdraw_connection", 2),
          ]);
        }
        return Promise.resolve([]);
      },
    );

    const batch = await getNextBatch("sender-1", 5);

    expect(batch.length).toBe(2);
    expect(batch.every((a) => a.actionType === "withdraw_connection")).toBe(true);
  });
});
