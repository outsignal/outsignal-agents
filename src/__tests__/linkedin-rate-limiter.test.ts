import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  applyJitter,
  bucketKeyFor,
  checkBudget,
  consumeBudget,
  getSenderBudget,
  getWarmupLimits,
  progressWarmup,
  getAccountWarmupSchedule,
} from "@/lib/linkedin/rate-limiter";

// ─── bucketKeyFor invariants ────────────────────────────────────────────────
//
// The BUDGET_BUCKETS map groups action types that share a daily limit. The
// first entry in each bucket is the canonical key. If someone reorders or
// edits the map without realising both connect/connection_request (and
// both profile_view/check_connection) must collapse to the same key, the
// bucket-keyed in-flight counter in queue.ts silently regresses — two
// types race against the same daily cap through separate Map slots.
// These invariants lock that contract down at test time.

describe("bucketKeyFor (shared-bucket invariants)", () => {
  it("connect and connection_request map to the same bucket", () => {
    expect(bucketKeyFor("connect")).toBe(bucketKeyFor("connection_request"));
  });

  it("profile_view and check_connection map to the same bucket", () => {
    expect(bucketKeyFor("profile_view")).toBe(bucketKeyFor("check_connection"));
  });

  it("message maps to its own bucket (distinct from connect and profile_view)", () => {
    expect(bucketKeyFor("message")).not.toBe(bucketKeyFor("connect"));
    expect(bucketKeyFor("message")).not.toBe(bucketKeyFor("profile_view"));
  });
});

// ─── applyJitter (BL-058 Bug 2: downward-only, base is hard ceiling) ───────
//
// Prior behaviour used `1 + factor` where factor ∈ (-0.2, 0.2), which let
// the effective cap rise above the configured base (e.g. base 6 → 7). That
// was the mathematical enabler for James's 9/6 overshoot on 2026-04-14.
// Fix: jitter now only REDUCES the limit — the configured base is a hard
// ceiling. These tests lock that contract.

describe("applyJitter (BL-058: hard upper ceiling)", () => {
  it("never exceeds the configured base limit", () => {
    for (const base of [1, 6, 8, 11, 20, 50, 100]) {
      // Sample many senderIds to exercise the hash space
      for (let i = 0; i < 200; i++) {
        const senderId = `sender-jitter-${base}-${i}`;
        const result = applyJitter(base, senderId);
        expect(result).toBeLessThanOrEqual(base);
      }
    }
  });

  it("stays within ±20% reduction band (never goes below 80% of base)", () => {
    // base=100 so rounding doesn't dominate. 80% of 100 = 80.
    for (let i = 0; i < 200; i++) {
      const senderId = `sender-jitter-band-${i}`;
      const result = applyJitter(100, senderId);
      expect(result).toBeGreaterThanOrEqual(80);
      expect(result).toBeLessThanOrEqual(100);
    }
  });

  it("is deterministic for a given (senderId, day) pair", () => {
    const a = applyJitter(10, "sender-stable");
    const b = applyJitter(10, "sender-stable");
    expect(a).toBe(b);
  });

  it("clamps to minimum of 1 for very small bases", () => {
    // base=1 with max downward jitter of -20% → round(0.8) = 1 (due to Math.max floor)
    for (let i = 0; i < 50; i++) {
      const result = applyJitter(1, `sender-min-${i}`);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(1);
    }
  });

  it("produces spread values across senders (not all clamped to base)", () => {
    // Sanity check: the distribution should actually produce reduced values,
    // not just always return base. Otherwise the jitter is useless.
    const results = new Set<number>();
    for (let i = 0; i < 500; i++) {
      results.add(applyJitter(100, `sender-spread-${i}`));
    }
    // Should see at least 10 distinct values in 500 samples with a 0.2 range.
    expect(results.size).toBeGreaterThan(10);
    // And at least some should be strictly below the base.
    const belowBase = Array.from(results).filter((v) => v < 100);
    expect(belowBase.length).toBeGreaterThan(0);
  });
});

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
    // Default: no running actions unless a test overrides.
    // checkBudget calls linkedInAction.count for BOTH the P1 bypass check
    // AND the belt-and-braces running-action tally. Without this default,
    // a mockResolvedValue from a previous test leaks into the next.
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
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

  // ── Running-action belt-and-braces tests (BL-safety, 2026-04-14) ────────
  //
  // checkBudget now counts actions in status='running' as already-consumed.
  // This prevents cross-poll races where a batch has been picked up (markRunning)
  // but the daily usage counter hasn't been incremented yet (consumeBudget
  // runs after completion). Without this guard a second poll tick would
  // re-approve the same budget slot.

  it("treats running actions as consumed for daily budget", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 6,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    // usage=4 + 2 running = 6 effective. With BL-058 jitter, max jittered
    // limit = base = 6 (hard ceiling). We need effectiveUsage > max jittered
    // limit to deterministically block. Set usage=10 so effectiveUsage=12 > 6.
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 10,
    });
    // 2 actions currently running. Effective usage = 10 + 2 = 12 > any jittered 6.
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reason).toContain("Daily");
    expect(result.reason).toContain("running");
  });

  it("blocks exactly at the boundary where running pushes usage over limit", async () => {
    // Specification test: usage=4, running=2, limit=6. Even with max jitter (7),
    // effectiveUsage=6 leaves remaining ≤ 1. With min jitter (5), blocks immediately.
    // Use a higher base limit to test the +running semantics cleanly.
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 100, // high enough to survive jitter
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 50,
    });
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(10);

    const result = await checkBudget("sender-1", "connect");

    // Min jittered limit = 80. effectiveUsage = 50+10 = 60. remaining ≥ 20.
    // Without the running count, remaining would be higher — verify the count is applied.
    expect(result.allowed).toBe(true);
    // effectiveUsage should reflect running actions
    expect(prisma.linkedInAction.count).toHaveBeenCalledWith({
      where: {
        senderId: "sender-1",
        actionType: { in: ["connect", "connection_request"] },
        status: "running",
      },
    });
  });

  it("allows action when running count + used is below limit", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 10,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 4,
    });
    // 2 running + 4 used = 6. Limit 10 (jittered ±20% so ~8-12). Should allow.
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(2);

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("counts running actions across the shared connect/connection_request bucket", async () => {
    // The budget bucket for 'connect' includes both 'connect' and
    // 'connection_request' — checkBudget MUST pass both types to the count
    // query so a mid-flight connection_request blocks a new connect slot.
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 15,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
    });
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await checkBudget("sender-1", "connect");

    // Verify the count query used both action types in the bucket
    const countCall = (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mock.calls.find(
      (args) => {
        const where = args[0]?.where;
        return where?.status === "running" && Array.isArray(where?.actionType?.in);
      },
    );
    expect(countCall).toBeDefined();
    expect(countCall![0].where.actionType.in).toEqual(
      expect.arrayContaining(["connect", "connection_request"]),
    );
    expect(countCall![0].where.status).toBe("running");
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

  // ── F5: profile_view bucket enforcement ─────────────────────────────────
  //
  // profile_view and check_connection share a bucket. Running actions of
  // either type must be counted against the shared daily profile-view limit.

  it("counts running actions across the shared profile_view/check_connection bucket", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      dailyMessageLimit: 30,
      dailyProfileViewLimit: 50,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      profileViews: 0,
    });
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await checkBudget("sender-1", "profile_view");

    const countCall = (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mock.calls.find(
      (args) => {
        const where = args[0]?.where;
        return where?.status === "running" && Array.isArray(where?.actionType?.in);
      },
    );
    expect(countCall).toBeDefined();
    expect(countCall![0].where.actionType.in).toEqual(
      expect.arrayContaining(["profile_view", "check_connection"]),
    );
  });

  it("blocks profile_view when running count + used exceeds shared bucket limit", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      dailyMessageLimit: 30,
      dailyProfileViewLimit: 10,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    // usage=9 + 5 running = 14 > any jittered 10 → block
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      profileViews: 9,
    });
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(5);

    const result = await checkBudget("sender-1", "profile_view");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  // ── F5: null/undefined usage field fallback ─────────────────────────────
  //
  // If the daily usage row exists but the counter field is null/undefined
  // (schema migration, test fixture, whatever), we must treat it as 0 —
  // NOT NaN, which would poison `remaining` math downstream.

  it("treats null usage field as 0 (no NaN remaining)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 10,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: null, // explicit null — should fall back to 0
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    expect(Number.isFinite(result.remaining)).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it("treats undefined usage field as 0 (no NaN remaining)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 10,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      // connectionsSent omitted entirely
    });

    const result = await checkBudget("sender-1", "connect");

    expect(result.allowed).toBe(true);
    expect(Number.isFinite(result.remaining)).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });
});

// ─── getSenderBudget ─────────────────────────────────────────────────────────
//
// F2 regression: getSenderBudget previously used raw `limit - sent` which
// ignored the pending-count reduction, acceptance-rate reduction, and
// running-action subtraction. The worker's spread math (which sums
// `remaining` across connections + messages + profile views) therefore
// over-estimated daily budget and front-loaded sending. Fix: route every
// `remaining` through checkBudget so the gate logic lines up exactly.

describe("getSenderBudget (mirrors checkBudget gate logic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
    (prisma.linkedInConnection.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  });

  it("halves connections remaining when pending count triggers 50% reduction at 1600", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      dailyMessageLimit: 30,
      dailyProfileViewLimit: 50,
      pendingConnectionCount: 1600, // 1500 ≤ x < 2000 → floor(limit / 2)
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
      messagesSent: 0,
      profileViews: 0,
    });

    const budget = await getSenderBudget("sender-1");

    expect(budget).not.toBeNull();
    // Jittered base ~16-24. After halving: ~8-12. Must be ≤ floor(24/2) = 12.
    expect(budget!.connections.remaining).toBeLessThanOrEqual(12);
    // And strictly less than the raw limit field (which is unreduced).
    expect(budget!.connections.remaining).toBeLessThan(budget!.connections.limit);
    // Messages/profile views are unaffected by pending count — full remaining.
    expect(budget!.messages.remaining).toBeGreaterThan(0);
    expect(budget!.profileViews.remaining).toBeGreaterThan(0);
  });

  it("caps connections remaining at 3 when pending count hits 2000", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      dailyMessageLimit: 30,
      dailyProfileViewLimit: 50,
      pendingConnectionCount: 2000,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
      messagesSent: 0,
      profileViews: 0,
    });

    const budget = await getSenderBudget("sender-1");

    expect(budget).not.toBeNull();
    expect(budget!.connections.remaining).toBeLessThanOrEqual(3);
  });

  it("returns 0 remaining for connections when acceptance-rate gate blocks", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 20,
      dailyMessageLimit: 30,
      dailyProfileViewLimit: 50,
      pendingConnectionCount: 0,
      acceptanceRate: 0.05, // below 10%
    });
    (prisma.linkedInConnection.count as ReturnType<typeof vi.fn>).mockResolvedValue(100);
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 0,
      messagesSent: 0,
      profileViews: 0,
    });

    const budget = await getSenderBudget("sender-1");

    expect(budget).not.toBeNull();
    // Acceptance gate blocks connects → remaining must be 0.
    expect(budget!.connections.remaining).toBe(0);
    // Messages/views unaffected — full remaining.
    expect(budget!.messages.remaining).toBeGreaterThan(0);
    expect(budget!.profileViews.remaining).toBeGreaterThan(0);
  });

  it("subtracts running actions from remaining (race-safe)", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
      status: "active",
      healthStatus: "healthy",
      dailyConnectionLimit: 10,
      dailyMessageLimit: 10,
      dailyProfileViewLimit: 10,
      pendingConnectionCount: 0,
      acceptanceRate: null,
    });
    (prisma.linkedInDailyUsage.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      connectionsSent: 5,
      messagesSent: 5,
      profileViews: 5,
    });
    // 3 running in each bucket
    (prisma.linkedInAction.count as ReturnType<typeof vi.fn>).mockResolvedValue(3);

    const budget = await getSenderBudget("sender-1");

    expect(budget).not.toBeNull();
    // Min jittered limit ~8. effectiveUsage = 5 + 3 = 8. Remaining ≤ ~4.
    expect(budget!.connections.remaining).toBeLessThanOrEqual(4);
    expect(budget!.messages.remaining).toBeLessThanOrEqual(4);
    expect(budget!.profileViews.remaining).toBeLessThanOrEqual(4);
  });

  it("returns null for missing sender", async () => {
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const budget = await getSenderBudget("missing");

    expect(budget).toBeNull();
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
