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

// Mock the rate-limiter module
vi.mock("@/lib/linkedin/rate-limiter", () => ({
  checkBudget: vi.fn().mockResolvedValue({ allowed: true, remaining: 10 }),
  checkCircuitBreaker: vi.fn().mockResolvedValue({ tripped: false, consecutiveFailures: 0 }),
}));

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

describe("getNextBatch — type-fair allocation", () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allocates batch slots to both connection_requests and profile_views", async () => {
    // Simulate: 10 connection_requests and 10 profile_views pending
    const connections = Array.from({ length: 10 }, (_, i) =>
      makeAction(`conn-${i}`, "connection_request"),
    );
    const views = Array.from({ length: 10 }, (_, i) =>
      makeAction(`view-${i}`, "profile_view"),
    );

    // Mock findMany to return the right actions based on actionType filter
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
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
    );

    const batch = await getNextBatch("sender-1", 10);

    // Both types should be present
    const connectionCount = batch.filter(
      (a) => a.actionType === "connection_request" || a.actionType === "connect",
    ).length;
    const viewCount = batch.filter(
      (a) => a.actionType === "profile_view" || a.actionType === "check_connection",
    ).length;

    expect(connectionCount).toBeGreaterThan(0);
    expect(viewCount).toBeGreaterThan(0);
    expect(batch.length).toBeLessThanOrEqual(10);
  });

  it("connection_requests are not starved when many profile_views are pending", async () => {
    // Simulate the starvation scenario: 200 profile_views, 5 connection_requests
    const connections = Array.from({ length: 5 }, (_, i) =>
      makeAction(`conn-${i}`, "connection_request"),
    );
    const views = Array.from({ length: 200 }, (_, i) =>
      makeAction(`view-${i}`, "profile_view"),
    );

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
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
    );

    const batch = await getNextBatch("sender-1", 10);

    // Connection requests MUST appear in the batch
    const connectionCount = batch.filter(
      (a) => a.actionType === "connection_request",
    ).length;

    expect(connectionCount).toBeGreaterThanOrEqual(1);
    // All 5 connections should be included (within the 50% allocation of 5 slots)
    expect(connectionCount).toBe(5);
  });

  it("fills remaining slots with other action types when one type has no pending actions", async () => {
    // No connection requests pending, only profile views
    const views = Array.from({ length: 20 }, (_, i) =>
      makeAction(`view-${i}`, "profile_view"),
    );

    (prisma.linkedInAction.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      (args: { where: { actionType?: { in: string[] } } }) => {
        const types = args.where?.actionType?.in ?? [];
        if (types.includes("connect") || types.includes("connection_request")) {
          return Promise.resolve([]); // no connections pending
        }
        if (types.includes("profile_view") || types.includes("check_connection")) {
          return Promise.resolve(views);
        }
        if (types.includes("message")) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
    );

    const batch = await getNextBatch("sender-1", 10);

    // With no connections or messages, views should backfill to use all available slots
    expect(batch.length).toBe(10);
    expect(batch.every((a) => a.actionType === "profile_view")).toBe(true);
  });
});
