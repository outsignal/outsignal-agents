import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObjectMock = vi.fn();

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

import { classifyReply, normalizeClassificationResult } from "../classify-reply";

describe("normalizeClassificationResult", () => {
  it("passes valid classification output through", () => {
    expect(
      normalizeClassificationResult({
        intent: "interested",
        sentiment: "positive",
        objectionSubtype: null,
        summary: "Asked for more details.",
      }),
    ).toEqual({
      intent: "interested",
      sentiment: "positive",
      objectionSubtype: null,
      summary: "Asked for more details.",
    });
  });

  it("truncates oversized summaries after parsing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const normalized = normalizeClassificationResult({
      intent: "not_relevant",
      sentiment: "neutral",
      objectionSubtype: null,
      summary: `${"S".repeat(220)}   `,
    });

    expect(normalized.summary).toHaveLength(200);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("truncating to 200"),
    );
    warnSpy.mockRestore();
  });
});

describe("classifyReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes Anthropic output before returning it", async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        intent: "meeting_booked",
        sentiment: "positive",
        objectionSubtype: null,
        summary: `${"Booked. ".repeat(40)}`,
      },
    });

    const result = await classifyReply({
      subject: "Re: intro",
      bodyText: "Tuesday works.",
      senderName: "Ada",
      outboundSubject: "Intro",
      outboundBody: "Worth a quick chat?",
    });

    expect(result.summary).toHaveLength(200);
  });
});
