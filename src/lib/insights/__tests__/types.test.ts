import { describe, expect, it, vi } from "vitest";
import { normalizeInsightGeneration } from "../types";

function makeInsight(priority: number) {
  return {
    category: "performance" as const,
    observation: "Reply rate changed materially.",
    evidence: [{ metric: "reply_rate", value: "12%", change: "+2%" }],
    suggestedAction: {
      type: "pause_campaign" as const,
      description: "Review campaign performance.",
      params: null,
    },
    confidence: "medium" as const,
    priority,
  };
}

describe("normalizeInsightGeneration", () => {
  it("passes valid insight output through", () => {
    expect(normalizeInsightGeneration({ insights: [makeInsight(4)] })).toEqual({
      insights: [makeInsight(4)],
    });
  });

  it("truncates oversized insight arrays and clamps priority", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const normalized = normalizeInsightGeneration({
      insights: [
        makeInsight(-1),
        makeInsight(2),
        makeInsight(3),
        makeInsight(4),
        makeInsight(5),
        makeInsight(99),
      ],
    });

    expect(normalized.insights).toHaveLength(5);
    expect(normalized.insights[0].priority).toBe(1);
    expect(normalized.insights[4].priority).toBe(5);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("allows empty insight output with a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(normalizeInsightGeneration({ insights: [] })).toEqual({
      insights: [],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("returned no insights"),
    );
    warnSpy.mockRestore();
  });
});
