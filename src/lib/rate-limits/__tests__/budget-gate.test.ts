import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BudgetSnapshot } from "../tracker";

// Mock the tracker module
vi.mock("../tracker", () => ({
  getBudgetSnapshot: vi.fn(),
}));

import { getBudgetSnapshot } from "../tracker";
import { checkBudget, printBudgetStatus } from "../budget-gate";

const mockGetBudgetSnapshot = vi.mocked(getBudgetSnapshot);

function makeSnapshot(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    totalWeight: 0,
    windowHours: 5,
    percentageUsed: 0,
    bySession: {},
    recordCount: 0,
    oldestRecord: null,
    newestRecord: null,
    ...overrides,
  };
}

describe("checkBudget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FORCE_BYPASS_BUDGET;
  });

  it("allows at < 60%", async () => {
    mockGetBudgetSnapshot.mockResolvedValue(
      makeSnapshot({ percentageUsed: 30 }),
    );

    const result = await checkBudget("test-agent");
    expect(result.allow).toBe(true);
    expect(result.queued).toBe(false);
    expect(result.percentOfBudget).toBe(30);
  });

  it("allows with warning at 60-85%", async () => {
    mockGetBudgetSnapshot.mockResolvedValue(
      makeSnapshot({ percentageUsed: 72 }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await checkBudget("test-agent");
    expect(result.allow).toBe(true);
    expect(result.queued).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("WARNING"),
    );

    warnSpy.mockRestore();
  });

  it("blocks (queued) at 85-100%", async () => {
    mockGetBudgetSnapshot.mockResolvedValue(
      makeSnapshot({ percentageUsed: 92 }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkBudget("test-agent");
    expect(result.allow).toBe(false);
    expect(result.queued).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("BLOCKED"),
    );

    errorSpy.mockRestore();
  });

  it("hard blocks at >= 100%", async () => {
    mockGetBudgetSnapshot.mockResolvedValue(
      makeSnapshot({ percentageUsed: 110 }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkBudget("test-agent");
    expect(result.allow).toBe(false);
    expect(result.queued).toBe(false);
    expect(result.reason).toContain("Hard block");

    errorSpy.mockRestore();
  });

  it("allows at >= 100% with FORCE_BYPASS_BUDGET=1", async () => {
    process.env.FORCE_BYPASS_BUDGET = "1";
    mockGetBudgetSnapshot.mockResolvedValue(
      makeSnapshot({ percentageUsed: 120 }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await checkBudget("test-agent");
    expect(result.allow).toBe(true);
    expect(result.queued).toBe(false);
    expect(result.reason).toContain("FORCE_BYPASS_BUDGET");

    warnSpy.mockRestore();
  });

  it("includes snapshot in result", async () => {
    const snap = makeSnapshot({
      percentageUsed: 10,
      totalWeight: 5000,
      recordCount: 42,
    });
    mockGetBudgetSnapshot.mockResolvedValue(snap);

    const result = await checkBudget("test-agent");
    expect(result.snapshot).toBe(snap);
    expect(result.snapshot.recordCount).toBe(42);
  });

  it("boundary: exactly 60% triggers warning band", async () => {
    mockGetBudgetSnapshot.mockResolvedValue(
      makeSnapshot({ percentageUsed: 60 }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await checkBudget("test-agent");
    expect(result.allow).toBe(true);
    warnSpy.mockRestore();
  });

  it("boundary: exactly 85% triggers block band", async () => {
    mockGetBudgetSnapshot.mockResolvedValue(
      makeSnapshot({ percentageUsed: 85 }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkBudget("test-agent");
    expect(result.allow).toBe(false);
    expect(result.queued).toBe(true);
    errorSpy.mockRestore();
  });

  it("boundary: exactly 100% triggers hard block", async () => {
    mockGetBudgetSnapshot.mockResolvedValue(
      makeSnapshot({ percentageUsed: 100 }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await checkBudget("test-agent");
    expect(result.allow).toBe(false);
    expect(result.queued).toBe(false);
    errorSpy.mockRestore();
  });
});

describe("printBudgetStatus", () => {
  it("prints budget status to stdout", async () => {
    mockGetBudgetSnapshot.mockResolvedValue(
      makeSnapshot({
        totalWeight: 5_000_000,
        percentageUsed: 6.25,
        recordCount: 100,
        bySession: { "session-abc": 3_000_000, "session-def": 2_000_000 },
        oldestRecord: new Date("2026-04-12T10:00:00Z"),
        newestRecord: new Date("2026-04-12T14:00:00Z"),
      }),
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await printBudgetStatus();

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("5.0M");
    expect(output).toContain("6.3%");
    expect(output).toContain("100");
    expect(output).toContain("OK");
    expect(output).toContain("session-");

    logSpy.mockRestore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
});
