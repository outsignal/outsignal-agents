import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrowMock = vi.fn();
const findManyMock = vi.fn();
const getCrawlMarkdownMock = vi.fn();
const generateObjectMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMock(...args),
    },
    company: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

vi.mock("@/lib/icp/crawl-cache", () => ({
  getCrawlMarkdown: (...args: unknown[]) => getCrawlMarkdownMock(...args),
}));

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

import { scoreStagedPersonIcpBatch } from "../scorer";

describe("scoreStagedPersonIcpBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueOrThrowMock.mockResolvedValue({
      slug: "test-workspace",
      icpCriteriaPrompt: "Prefer B2B SaaS operators at 50-500 employee companies",
    });
    findManyMock.mockResolvedValue([
      {
        domain: "acme.com",
        headcount: 150,
        industry: "Software",
        description: "B2B SaaS company",
        yearFounded: 2018,
      },
    ]);
    getCrawlMarkdownMock.mockResolvedValue("Acme builds SaaS products");
  });

  it("pins staged batch scoring to temperature 0", async () => {
    generateObjectMock.mockResolvedValue({
      object: [
        {
          personId: "dp_1",
          score: 82,
          reasoning: "Strong fit",
          confidence: "high",
        },
      ],
    });

    const results = await scoreStagedPersonIcpBatch(
      [
        {
          discoveredPersonId: "dp_1",
          firstName: "John",
          lastName: "Doe",
          jobTitle: "VP Operations",
          company: "Acme",
          companyDomain: "acme.com",
          location: "London",
        },
      ],
      "test-workspace",
    );

    expect(results.get("dp_1")).toEqual({
      status: "scored",
      score: 82,
      reasoning: "Strong fit",
      confidence: "high",
      scoringMethod: "firecrawl+llm",
    });
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
        system: "Prefer B2B SaaS operators at 50-500 employee companies",
      }),
    );
    expect(getCrawlMarkdownMock).toHaveBeenCalledWith("acme.com");
  });

  it("returns needs_website for staged leads without homepage content", async () => {
    getCrawlMarkdownMock.mockResolvedValueOnce(null);
    generateObjectMock.mockResolvedValue({ object: [] });

    const results = await scoreStagedPersonIcpBatch(
      [
        {
          discoveredPersonId: "dp_missing_site",
          firstName: "Jane",
          lastName: "Doe",
          jobTitle: "Operations Director",
          company: "No Site Ltd",
          companyDomain: "nosite.com",
          location: "Leeds",
        },
      ],
      "test-workspace",
    );

    expect(results.get("dp_missing_site")).toEqual({
      status: "needs_website",
      reasoning: "NEEDS_WEBSITE: company website content unavailable",
      confidence: "low",
      scoringMethod: null,
    });
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
