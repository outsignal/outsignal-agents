import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, notifySessionDropMock } = vi.hoisted(() => {
  const prismaMock = {
    sender: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    senderHealthEvent: {
      create: vi.fn(),
    },
    webhookEvent: {
      findMany: vi.fn(),
    },
    linkedInDailyUsage: {
      findMany: vi.fn(),
    },
    linkedInAction: {
      groupBy: vi.fn(),
      updateMany: vi.fn(),
    },
    campaign: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock)),
  };

  return {
    prismaMock,
    notifySessionDropMock: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/notifications", () => ({
  notifySessionDrop: notifySessionDropMock,
}));

import { runSenderHealthCheck } from "@/lib/linkedin/health-check";
import { refreshStaleSessions } from "@/lib/linkedin/session-refresh";

describe("LinkedIn session race guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("session refresh skips stale overwrite when a keepalive lands after the stale read", async () => {
    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "sender-1",
        name: "Daniel Lazarus",
        emailAddress: "daniel@example.com",
        workspaceSlug: "1210",
        lastKeepaliveAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
        workspace: { name: "1210 Solutions" },
      },
    ]);
    (prismaMock.sender.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const result = await refreshStaleSessions();

    expect(result).toEqual({ count: 0, senders: [] });
    expect(prismaMock.sender.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.senderHealthEvent.create).not.toHaveBeenCalled();
    expect(notifySessionDropMock).not.toHaveBeenCalled();
  });

  it("session refresh flags legitimately stale senders and writes both fields", async () => {
    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "sender-1",
        name: "Daniel Lazarus",
        emailAddress: "daniel@example.com",
        workspaceSlug: "1210",
        lastKeepaliveAt: new Date("2026-04-19T00:00:00.000Z"),
        updatedAt: new Date("2026-04-19T00:00:00.000Z"),
        workspace: { name: "1210 Solutions" },
      },
    ]);
    (prismaMock.sender.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });

    const result = await refreshStaleSessions();

    expect(result).toEqual({
      count: 1,
      senders: ["Daniel Lazarus (1210)"],
    });
    expect(prismaMock.sender.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "sender-1",
        sessionStatus: "active",
      }),
      data: {
        sessionStatus: "expired",
        healthStatus: "session_expired",
      },
    });
    expect(prismaMock.senderHealthEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderId: "sender-1",
        status: "session_expired",
        reason: "session_expired",
      }),
    });
    expect(notifySessionDropMock).toHaveBeenCalledTimes(1);
  });

  it("session refresh uses the legacy null-keepalive fallback and still skips raced writes", async () => {
    const staleLegacySender = {
      id: "sender-legacy",
      name: "Daniel Lazarus",
      emailAddress: "daniel@example.com",
      workspaceSlug: "1210",
      lastKeepaliveAt: null,
      updatedAt: new Date("2026-04-10T00:00:00.000Z"),
      workspace: { name: "1210 Solutions" },
    };

    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      staleLegacySender,
    ]);
    (prismaMock.sender.updateMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const firstResult = await refreshStaleSessions();
    expect(firstResult).toEqual({
      count: 1,
      senders: ["Daniel Lazarus (1210)"],
    });
    expect(prismaMock.sender.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "sender-legacy",
        sessionStatus: "active",
        OR: [
          {
            lastKeepaliveAt: {
              not: null,
              lt: expect.any(Date),
            },
          },
          {
            lastKeepaliveAt: null,
            updatedAt: {
              lt: expect.any(Date),
            },
          },
        ],
      },
      data: {
        sessionStatus: "expired",
        healthStatus: "session_expired",
      },
    });

    const secondResult = await refreshStaleSessions();
    expect(secondResult).toEqual({ count: 0, senders: [] });
    expect(prismaMock.sender.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.senderHealthEvent.create).toHaveBeenCalledTimes(1);
    expect(notifySessionDropMock).toHaveBeenCalledTimes(1);
  });

  it("session refresh does not treat a keepalive exactly 12 hours old as stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));

    const boundarySender = {
      id: "sender-boundary",
      name: "Daniel Lazarus",
      emailAddress: "daniel@example.com",
      workspaceSlug: "1210",
      lastKeepaliveAt: new Date("2026-04-20T00:00:00.000Z"),
      updatedAt: new Date("2026-04-19T23:59:59.000Z"),
      workspace: { name: "1210 Solutions" },
    };

    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { OR: Array<{ lastKeepaliveAt?: { lt: Date; not: null }; updatedAt?: { lt: Date } }> } }) => {
        const keepaliveThreshold = where.OR[0]?.lastKeepaliveAt?.lt;
        const legacyThreshold = where.OR[1]?.updatedAt?.lt;
        const isKeepaliveStale =
          keepaliveThreshold != null &&
          boundarySender.lastKeepaliveAt != null &&
          boundarySender.lastKeepaliveAt < keepaliveThreshold;
        const isLegacyStale =
          legacyThreshold != null &&
          boundarySender.lastKeepaliveAt == null &&
          boundarySender.updatedAt < legacyThreshold;

        return isKeepaliveStale || isLegacyStale ? [boundarySender] : [];
      },
    );

    const result = await refreshStaleSessions();

    expect(result).toEqual({ count: 0, senders: [] });
    expect(prismaMock.sender.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.senderHealthEvent.create).not.toHaveBeenCalled();
    expect(notifySessionDropMock).not.toHaveBeenCalled();
  });

  it("health check co-writes sessionStatus=expired when it marks a sender session_expired", async () => {
    const sender = {
      id: "sender-1",
      name: "Daniel Lazarus",
      emailAddress: "daniel@example.com",
      workspaceSlug: "1210",
      status: "active",
      sessionStatus: "expired",
      healthStatus: "healthy",
      healthFlaggedAt: null,
      lastActiveAt: new Date("2026-04-20T08:00:00.000Z"),
      workspace: { name: "1210 Solutions" },
    };

    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([sender])
      .mockResolvedValueOnce([sender])
      .mockResolvedValueOnce([]);
    (prismaMock.webhookEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prismaMock.linkedInDailyUsage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prismaMock.sender.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 });
    (prismaMock.sender.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const results = await runSenderHealthCheck();

    expect(results).toHaveLength(1);
    expect(prismaMock.sender.updateMany).toHaveBeenCalledWith({
      where: {
        id: "sender-1",
        sessionStatus: "expired",
      },
      data: expect.objectContaining({
        healthStatus: "session_expired",
        sessionStatus: "expired",
      }),
    });
    expect(prismaMock.senderHealthEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderId: "sender-1",
        status: "session_expired",
        reason: "session_expired",
      }),
    });
    expect(notifySessionDropMock).toHaveBeenCalledTimes(1);
  });

  it("health check skips stale session_expired overwrite if a keepalive healed the sender mid-race", async () => {
    const sender = {
      id: "sender-1",
      name: "Daniel Lazarus",
      emailAddress: "daniel@example.com",
      workspaceSlug: "1210",
      status: "active",
      sessionStatus: "expired",
      healthStatus: "healthy",
      healthFlaggedAt: null,
      lastActiveAt: new Date("2026-04-20T08:00:00.000Z"),
      workspace: { name: "1210 Solutions" },
    };
    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([sender])
      .mockResolvedValueOnce([sender]);
    (prismaMock.webhookEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prismaMock.linkedInDailyUsage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prismaMock.sender.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 });

    const results = await runSenderHealthCheck();

    expect(results).toEqual([]);
    expect(prismaMock.senderHealthEvent.create).not.toHaveBeenCalled();
    expect(notifySessionDropMock).not.toHaveBeenCalled();
  });

  it("health check re-fetches only LinkedIn-capable senders before applying new flags", async () => {
    const sender = {
      id: "sender-1",
      name: "Daniel Lazarus",
      emailAddress: "daniel@example.com",
      workspaceSlug: "1210",
      status: "active",
      sessionStatus: "active",
      healthStatus: "healthy",
      healthFlaggedAt: null,
      lastActiveAt: new Date("2026-04-20T08:00:00.000Z"),
      workspace: { name: "1210 Solutions" },
    };

    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([sender])
      .mockResolvedValueOnce([]);
    (prismaMock.webhookEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prismaMock.linkedInDailyUsage.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await runSenderHealthCheck();

    expect(prismaMock.sender.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: { in: ["active", "setup"] },
        channel: { in: ["linkedin", "both"] },
      },
      include: { workspace: true },
    });
  });
});
