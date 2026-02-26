import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { checkBudget, consumeBudget, getWarmupLimits, progressWarmup } from "@/lib/linkedin/rate-limiter";

describe("getWarmupLimits", () => {
  it("returns week 1 limits for days 1-7", () => {
    expect(getWarmupLimits(1)).toEqual({ connections: 5, messages: 10, profileViews: 15 });
    expect(getWarmupLimits(7)).toEqual({ connections: 5, messages: 10, profileViews: 15 });
  });

  it("returns week 2 limits for days 8-14", () => {
    expect(getWarmupLimits(8)).toEqual({ connections: 8, messages: 15, profileViews: 25 });
    expect(getWarmupLimits(14)).toEqual({ connections: 8, messages: 15, profileViews: 25 });
  });

  it("returns week 3 limits for days 15-21", () => {
    expect(getWarmupLimits(15)).toEqual({ connections: 12, messages: 25, profileViews: 40 });
  });

  it("returns cruise limits for day 22+", () => {
    expect(getWarmupLimits(22)).toEqual({ connections: 15, messages: 30, profileViews: 50 });
    expect(getWarmupLimits(100)).toEqual({ connections: 15, messages: 30, profileViews: 50 });
  });

  it("returns conservative defaults for day 0", () => {
    expect(getWarmupLimits(0)).toEqual({ connections: 5, messages: 10, profileViews: 15 });
  });
});

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
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 5,
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

  it("reserves 20% of connection budget for priority 1 when checking priority 5", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 10,
    });
    // With 10 limit, 20% reserved = 2 reserved, effective limit ~8 for P5
    // At 8 connections sent, P5 should be blocked
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 9,
    });

    const resultP5 = await checkBudget("sender-1", "connect", 5);
    expect(resultP5.allowed).toBe(false);
  });
});

describe("consumeBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts daily usage with increment", async () => {
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

describe("progressWarmup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments warmup day and updates limits", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      warmupDay: 7,
      acceptanceRate: 0.35,
    });
    (prisma.sender.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await progressWarmup("sender-1");

    expect(prisma.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: {
        warmupDay: 8,
        dailyConnectionLimit: 8, // week 2 limits
        dailyMessageLimit: 15,
        dailyProfileViewLimit: 25,
      },
    });
  });

  it("does not increase limits if acceptance rate is below 20%", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      warmupDay: 7,
      acceptanceRate: 0.15, // below 20%
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
