import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { checkBudget, consumeBudget, getWarmupLimits, progressWarmup, getAccountWarmupSchedule } from "@/lib/linkedin/rate-limiter";

// ─── getWarmupLimits ────────────────────────────────────────────────────────

describe("getWarmupLimits", () => {
  it("returns conservative defaults for day 0 (no senderId)", () => {
    expect(getWarmupLimits(0)).toEqual({ connections: 5, messages: 10, profileViews: 15 });
  });

  it("returns base week 1 limits when no senderId is provided", () => {
    const limits = getWarmupLimits(1);
    expect(limits.connections).toBe(5);
    expect(limits.messages).toBe(5);
    expect(limits.profileViews).toBe(10);
  });

  it("returns base cruise limits for day 22+ when no senderId is provided", () => {
    const limits = getWarmupLimits(22);
    expect(limits.connections).toBe(20);
    expect(limits.messages).toBe(30);
    expect(limits.profileViews).toBe(50);
    // Same for very high day
    expect(getWarmupLimits(100)).toEqual(limits);
  });

  it("returns per-account jittered limits when senderId is provided", () => {
    const limitsA = getWarmupLimits(5, "sender-a");
    const limitsB = getWarmupLimits(5, "sender-b");
    // Both should be in a reasonable range around the base (5 connections for week 1)
    expect(limitsA.connections).toBeGreaterThanOrEqual(1);
    expect(limitsA.connections).toBeLessThanOrEqual(10);
    expect(limitsB.connections).toBeGreaterThanOrEqual(1);
    expect(limitsB.connections).toBeLessThanOrEqual(10);
  });

  it("returns stable (deterministic) results for the same senderId", () => {
    const first = getWarmupLimits(10, "sender-stable");
    const second = getWarmupLimits(10, "sender-stable");
    expect(first).toEqual(second);
  });
});

describe("getAccountWarmupSchedule", () => {
  it("returns 4 tiers for any senderId", () => {
    const schedule = getAccountWarmupSchedule("sender-1");
    expect(schedule.length).toBe(4);
    // Last tier always has Infinity maxDay
    expect(schedule[3].maxDay).toBe(Infinity);
  });

  it("tiers are monotonically increasing in maxDay", () => {
    const schedule = getAccountWarmupSchedule("sender-1");
    for (let i = 1; i < schedule.length - 1; i++) {
      expect(schedule[i].maxDay).toBeGreaterThan(schedule[i - 1].maxDay);
    }
  });
});

// ─── checkBudget ─────────────────────────────────────────────────────────────

describe("checkBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows action when sender is active and has budget", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 15,
      dailyMessageLimit: 30,
      dailyProfileViewLimit: 50,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 5,
      messagesSent: 10,
      profileViews: 20,
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("blocks when sender is not found", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await checkBudget("nonexistent", "connect");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Sender not found");
  });

  it("blocks when sender is paused", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "paused",
      healthStatus: "healthy",
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("paused");
  });

  it("blocks when sender health is not healthy", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "blocked",
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocked");
  });

  it("blocks when daily limit is reached", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 5,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 100, // way over any jittered limit
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("creates daily usage record if none exists", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 15,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.linkedInDailyUsage.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
      messagesSent: 0,
      profileViews: 0,
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    expect(prisma.linkedInDailyUsage.create).toHaveBeenCalled();
  });

  // ── withdraw_connection bypass ──────────────────────────────────────────

  it("always allows withdraw_connection actions (bypass budget)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 0, // zero budget
      pendingConnectionCount: 5000, // extreme pending count
      acceptanceRate: 0.01, // terrible acceptance rate
    });

    const result = await checkBudget("sender-1", "withdraw_connection");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Infinity);
  });

  // ── P1 bypass tests ────────────────────────────────────────────────────

  it("P1 connection actions bypass daily budget when under P1 cap (5/day)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 5,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    // Daily budget exhausted
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 100,
    });
    // Only 2 P1 completed today — under the cap of 5
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    const result = await checkBudget("sender-1", "connect", 1);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3); // 5 - 2 = 3
  });

  it("P1 connection actions fall through to normal budget when P1 cap reached", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 5,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    // P1 cap already reached (5 completed today)
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);
    // Daily budget also exhausted
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 100,
    });

    const result = await checkBudget("sender-1", "connect", 1);

    expect(result.allowed).toBe(false);
  });

  // ── Pending count gate tests ───────────────────────────────────────────

  it("allows connections at 1499 pending count (under all thresholds)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      pendingConnectionCount: 1499,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    // No budget reduction at 1499
  });

  it("halves budget at 1500 pending count", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      pendingConnectionCount: 1500,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    // Budget should be reduced (halved from the jittered limit)
    // The jittered limit varies, but remaining should be less than the full limit
    expect(result.remaining).toBeLessThanOrEqual(12); // floor(~20*1.2/2) max case
  });

  it("caps budget at 3 when pending count is 2000", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      pendingConnectionCount: 2000,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeLessThanOrEqual(3);
  });

  it("blocks at 2500 pending count (hard cap)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      pendingConnectionCount: 2500,
      acceptanceRate: null,
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Pending connection cap");
  });

  // ── Acceptance rate gate tests ─────────────────────────────────────────

  it("blocks at 9% acceptance rate with 50+ total sent", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      pendingConnectionCount: 0,
      acceptanceRate: 0.09,
    });
    (prisma.linkedInConnection.count as ReturnType<typeof vi.fn>).mockResolvedValue(100);

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Acceptance rate too low");
  });

  it("allows at 9% acceptance rate with less than 50 total sent (insufficient data)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      pendingConnectionCount: 0,
      acceptanceRate: 0.09,
    });
    (prisma.linkedInConnection.count as ReturnType<typeof vi.fn>).mockResolvedValue(30);
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
  });

  it("reduces budget by 30% at 12% acceptance rate with 50+ sent", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      pendingConnectionCount: 0,
      acceptanceRate: 0.12,
    });
    (prisma.linkedInConnection.count as ReturnType<typeof vi.fn>).mockResolvedValue(100);
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    // Budget reduced by 30% from the jittered limit (~20 base)
    // Max jittered = 24, * 0.7 = ~16. Should be less than full.
    expect(result.remaining).toBeLessThanOrEqual(17);
  });

  it("allows full budget at 20% acceptance rate (above warning threshold)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      pendingConnectionCount: 0,
      acceptanceRate: 0.20,
    });
    (prisma.linkedInConnection.count as ReturnType<typeof vi.fn>).mockResolvedValue(100);
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    // No reduction at 20%+ — full jittered budget
    expect(result.remaining).toBeGreaterThanOrEqual(10);
  });

  it("does not query linkedInConnection.count for non-connection action types", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      dailyMessageLimit: 30,
      dailyProfileViewLimit: 50,
      pendingConnectionCount: 0,
      acceptanceRate: 0.05, // very low but should not matter for messages
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      messagesSent: 0,
    });

    await checkBudget("sender-1", "message");

    expect(prisma.linkedInConnection.count).not.toHaveBeenCalled();
  });
});

// ─── consumeBudget ───────────────────────────────────────────────────────────

describe("consumeBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts daily usage with increment for connections", async () => {
    (prisma.linkedInDailyUsage.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await consumeBudget("sender-1", "connect");

    expect(prisma.linkedInDailyUsage.upsert).toHaveBeenCalledWith({
      where: expect.objectContaining({
        senderId_date: expect.objectContaining({
          senderId: "sender-1",
        }),
      }),
      create: expect.objectContaining({
        senderId: "sender-1",
        connectionsSent: 1,
      }),
      update: {
        connectionsSent: { increment: 1 },
      },
    });
  });

  it("increments correct field for message actions", async () => {
    (prisma.linkedInDailyUsage.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await consumeBudget("sender-1", "message");

    expect(prisma.linkedInDailyUsage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          messagesSent: 1,
        }),
        update: {
          messagesSent: { increment: 1 },
        },
      }),
    );
  });
});

// ─── progressWarmup ──────────────────────────────────────────────────────────

describe("progressWarmup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments warmup day and updates limits (using jittered values)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      warmupDay: 7,
      acceptanceRate: 0.35,
      warmupStartedAt: null, // skip idempotency check
    });
    (prisma.sender.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await progressWarmup("sender-1");

    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: expect.objectContaining({
        warmupDay: 8,
        // Jittered values — just verify they are numbers
        dailyConnectionLimit: expect.any(Number),
        dailyMessageLimit: expect.any(Number),
        dailyProfileViewLimit: expect.any(Number),
      }),
    });
  });

  it("does not increase limits if acceptance rate is below 20%", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      warmupDay: 7,
      acceptanceRate: 0.15, // below 20%
      warmupStartedAt: null,
    });

    await progressWarmup("sender-1");

    expect(prisma.sender.update).not.toHaveBeenCalled();
  });

  it("does nothing for senders not in warmup (day 0)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      warmupDay: 0,
    });

    await progressWarmup("sender-1");

    expect(prisma.sender.update).not.toHaveBeenCalled();
  });
});
