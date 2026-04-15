import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

import { generateObject } from "ai";
import { extractIcpCriteria, icpCriteriaSchema } from "../extract-criteria";

describe("extractIcpCriteria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the parsed object from generateObject and passes the description in the prompt", async () => {
    const expected = {
      industries: ["SaaS"],
      titles: ["CTO"],
      companySizes: ["11-50"],
      locations: ["UK"],
    };

    vi.mocked(generateObject).mockResolvedValueOnce({
      object: expected,
    } as unknown as Awaited<ReturnType<typeof generateObject>>);

    const description = "mid-size SaaS CTOs in UK";
    const result = await extractIcpCriteria(description);

    expect(result).toEqual(expected);
    expect(generateObject).toHaveBeenCalledTimes(1);

    const callArgs = vi.mocked(generateObject).mock.calls[0][0] as {
      prompt: string;
    };
    expect(callArgs.prompt).toContain(description);
  });
});

describe("icpCriteriaSchema", () => {
  it("parses a valid payload with all array fields", () => {
    const result = icpCriteriaSchema.safeParse({
      industries: ["SaaS"],
      titles: ["CTO", "VP Engineering"],
      companySizes: ["11-50", "51-200"],
      locations: ["United Kingdom"],
      keywords: ["b2b"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload where titles is not an array", () => {
    const result = icpCriteriaSchema.safeParse({
      industries: ["SaaS"],
      titles: "not-an-array",
      companySizes: ["11-50"],
      locations: ["UK"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing the required industries field", () => {
    const result = icpCriteriaSchema.safeParse({
      titles: ["CTO"],
      companySizes: ["11-50"],
      locations: ["UK"],
    });
    expect(result.success).toBe(false);
  });

  it("parses successfully when optional keywords is omitted", () => {
    const result = icpCriteriaSchema.safeParse({
      industries: ["SaaS"],
      titles: ["CTO"],
      companySizes: ["11-50"],
      locations: ["UK"],
    });
    expect(result.success).toBe(true);
  });
});
