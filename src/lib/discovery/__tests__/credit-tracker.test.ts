import { describe, it, expect, vi, beforeEach } from "vitest";
import { estimateSearchCost, reportSearchCost } from "../credit-tracker";

// Mock prisma for getPlatformBalance
vi.mock("@/lib/db", () => ({
  prisma: {
    enrichmentLog: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { costUsd: 5.5 } }),
    },
  },
}));

describe("estimateSearchCost", () => {
  it("estimates zero cost for apollo (free)", () => {
    const result = estimateSearchCost([{ name: "apollo", estimatedVolume: 100 }]);
    expect(result.totalEstimatedUsd).toBe(0);
    expect(result.breakdown[0].estimatedUsd).toBe(0);
  });

  it("estimates cost for prospeo (per-call pricing)", () => {
    const result = estimateSearchCost([{ name: "prospeo", estimatedVolume: 50 }]);
    // 50 results / 25 per page = 2 calls * $0.002 = $0.004
    expect(result.totalEstimatedUsd).toBe(0.004);
  });

  it("estimates cost for leads-finder (per-lead pricing)", () => {
    const result = estimateSearchCost([{ name: "leads-finder", estimatedVolume: 100 }]);
    // 100 leads * $0.002 = $0.2
    expect(result.totalEstimatedUsd).toBe(0.2);
  });

  it("estimates cost for ecommerce-stores (per-lead pricing)", () => {
    const result = estimateSearchCost([{ name: "ecommerce-stores", estimatedVolume: 50 }]);
    // 50 leads * $0.004 = $0.2
    expect(result.totalEstimatedUsd).toBe(0.2);
  });

  it("aggregates cost across multiple sources", () => {
    const result = estimateSearchCost([
      { name: "apollo", estimatedVolume: 100 },
      { name: "prospeo", estimatedVolume: 50 },
      { name: "aiark", estimatedVolume: 50 },
    ]);
    // apollo: 0, prospeo: 2 calls * 0.002 = 0.004, aiark: 2 calls * 0.003 = 0.006
    expect(result.totalEstimatedUsd).toBe(0.01);
    expect(result.breakdown).toHaveLength(3);
  });

  it("handles unknown platforms with zero cost", () => {
    const result = estimateSearchCost([{ name: "unknown-source", estimatedVolume: 100 }]);
    expect(result.totalEstimatedUsd).toBe(0);
  });
});

describe("reportSearchCost", () => {
  it("aggregates cost across multiple runs", () => {
    const report = reportSearchCost(
      [
        { platform: "prospeo", costUsd: 0.004, resultCount: 50 },
        { platform: "aiark", costUsd: 0.006, resultCount: 50 },
      ],
      40,
    );
    expect(report.totalCostUsd).toBe(0.01);
    expect(report.platformBreakdown).toHaveLength(2);
  });

  it("computes costPerVerifiedLead correctly", () => {
    const report = reportSearchCost(
      [{ platform: "prospeo", costUsd: 0.1, resultCount: 50 }],
      25,
    );
    expect(report.costPerVerifiedLead).toBe(0.004);
  });

  it("returns null costPerVerifiedLead when zero verified", () => {
    const report = reportSearchCost(
      [{ platform: "prospeo", costUsd: 0.1, resultCount: 50 }],
      0,
    );
    expect(report.costPerVerifiedLead).toBe(null);
  });

  it("handles single run", () => {
    const report = reportSearchCost(
      [{ platform: "apollo", costUsd: 0, resultCount: 100 }],
      80,
    );
    expect(report.totalCostUsd).toBe(0);
    expect(report.costPerVerifiedLead).toBe(0);
  });

  it("rounds cost values to 3 decimal places", () => {
    const report = reportSearchCost(
      [{ platform: "prospeo", costUsd: 0.0033333, resultCount: 10 }],
      3,
    );
    expect(report.totalCostUsd).toBe(0.003);
  });
});

describe("getPlatformBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries EnrichmentLog and returns balance estimate", async () => {
    // Dynamic import to get the mocked version
    const { getPlatformBalance } = await import("../credit-tracker");
    const balance = await getPlatformBalance("prospeo");
    expect(balance.platform).toBe("prospeo");
    expect(balance.monthlySpent).toBe(5.5);
    expect(balance.source).toBe("estimate");
    expect(balance.monthlyBudget).toBe(25);
    expect(balance.creditsRemaining).toBe(19.5);
  });
});
