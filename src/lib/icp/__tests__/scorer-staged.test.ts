import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
const findUniqueOrThrowMock = vi.fn();
const findUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMock(...args),
    },
    company: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

// Mock crawl-cache
const getCrawlMarkdownMock = vi.fn();
vi.mock("@/lib/icp/crawl-cache", () => ({
  getCrawlMarkdown: (...args: unknown[]) => getCrawlMarkdownMock(...args),
}));

// Mock AI SDK
const generateObjectMock = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

import { scoreStagedPersonIcp } from "../scorer";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("scoreStagedPersonIcp", () => {
  const mockWorkspace = {
    slug: "test-workspace",
    icpCriteriaPrompt: "Our ICP is B2B SaaS companies with 50-500 employees",
    icpScoreThreshold: 40,
  };

  const fullInput = {
    firstName: "John",
    lastName: "Doe",
    jobTitle: "CTO",
    company: "Acme Corp",
    companyDomain: "acme.com",
    location: "London, UK",
  };

  it("scores a staged person with full data", async () => {
    findUniqueOrThrowMock.mockResolvedValue(mockWorkspace);
    getCrawlMarkdownMock.mockResolvedValue("Acme Corp builds SaaS products");
    findUniqueMock.mockResolvedValue({
      headcount: 150,
      industry: "Software",
      description: "B2B SaaS company",
      yearFounded: 2018,
    });
    generateObjectMock.mockResolvedValue({
      object: { score: 85, reasoning: "Strong ICP fit", confidence: "high" },
    });

    const result = await scoreStagedPersonIcp(fullInput, "test-workspace");

    expect(result.status).toBe("scored");
    expect(result.status).toBe("scored");
    expect(result.scoringMethod).toBe("firecrawl+llm");
    if (result.status !== "scored") {
      throw new Error("expected scored result");
    }
    expect(result.score).toBe(85);
    expect(result.reasoning).toBe("Strong ICP fit");
    expect(result.confidence).toBe("high");
    expect(getCrawlMarkdownMock).toHaveBeenCalledWith("acme.com");
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("returns needs_website when company domain is missing", async () => {
    findUniqueOrThrowMock.mockResolvedValue(mockWorkspace);

    const result = await scoreStagedPersonIcp(
      { ...fullInput, companyDomain: null },
      "test-workspace",
    );

    expect(result.status).toBe("needs_website");
    expect(result.reasoning).toContain("NEEDS_WEBSITE");
    expect(result.confidence).toBe("low");
    // Should not attempt crawl or company lookup without domain
    expect(getCrawlMarkdownMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("throws when workspace has no ICP criteria prompt", async () => {
    findUniqueOrThrowMock.mockResolvedValue({
      ...mockWorkspace,
      icpCriteriaPrompt: null,
    });

    await expect(
      scoreStagedPersonIcp(fullInput, "test-workspace"),
    ).rejects.toThrow("No ICP criteria prompt configured");
  });

  it("does NOT persist score (caller handles persistence)", async () => {
    findUniqueOrThrowMock.mockResolvedValue(mockWorkspace);
    getCrawlMarkdownMock.mockResolvedValue("Acme homepage");
    findUniqueMock.mockResolvedValue(null);
    generateObjectMock.mockResolvedValue({
      object: { score: 50, reasoning: "Moderate fit", confidence: "medium" },
    });

    const result = await scoreStagedPersonIcp(fullInput, "test-workspace");

    if (result.status !== "scored") {
      throw new Error("expected scored result");
    }
    expect(result).toEqual({
      status: "scored",
      score: 50,
      reasoning: "Moderate fit",
      confidence: "medium",
      scoringMethod: "firecrawl+llm",
    });
    // No prisma update calls — caller is responsible for persisting
  });
});
