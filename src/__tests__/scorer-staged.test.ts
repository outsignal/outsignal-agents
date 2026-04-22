import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUniqueOrThrow: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock crawl cache
vi.mock("@/lib/icp/crawl-cache", () => ({
  getCrawlMarkdown: vi.fn().mockResolvedValue("Homepage content here"),
}));

// Mock AI SDK generateObject — use a module-level object to avoid hoisting issues
vi.mock("ai", () => {
  const mock = vi.fn();
  return {
    generateObject: mock,
    __mockGenerateObject: mock,
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn().mockReturnValue("mock-model"),
}));

import { prisma } from "@/lib/db";
import { scoreStagedPersonIcp } from "@/lib/icp/scorer";

// Access the mock via the module
let generateObjectMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const aiModule = await import("ai") as unknown as { __mockGenerateObject: ReturnType<typeof vi.fn> };
  generateObjectMock = aiModule.__mockGenerateObject;
});

const mockWorkspace = prisma.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>;
const mockCompany = prisma.company.findUnique as ReturnType<typeof vi.fn>;

describe("scoreStagedPersonIcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspace.mockResolvedValue({
      slug: "test-ws",
      icpCriteriaPrompt: "Score B2B SaaS CTOs highly",
    });
    mockCompany.mockResolvedValue({
      domain: "acme.com",
      headcount: 150,
      industry: "SaaS",
      description: "B2B SaaS platform",
      yearFounded: 2020,
    });
  });

  it("scores a staged person with full data", async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        score: 85,
        reasoning: "Strong ICP fit: CTO at B2B SaaS company",
        confidence: "high",
      },
    });

    const result = await scoreStagedPersonIcp(
      {
        firstName: "John",
        lastName: "Doe",
        jobTitle: "CTO",
        company: "Acme Corp",
        companyDomain: "acme.com",
        location: "London",
      },
      "test-ws",
    );

    expect(result.status).toBe("scored");
    expect(result.scoringMethod).toBe("firecrawl+llm");
    if (result.status !== "scored") {
      throw new Error("expected scored result");
    }
    expect(result.score).toBe(85);
    expect(result.reasoning).toBe("Strong ICP fit: CTO at B2B SaaS company");
    expect(result.confidence).toBe("high");

    // Verify temperature=0 is passed for deterministic scoring
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0 }),
    );
  });

  it("throws when workspace has no ICP criteria prompt", async () => {
    mockWorkspace.mockResolvedValue({
      slug: "test-ws",
      icpCriteriaPrompt: null,
    });

    await expect(
      scoreStagedPersonIcp(
        {
          firstName: "John",
          lastName: "Doe",
          jobTitle: "CTO",
          company: "Acme",
          companyDomain: "acme.com",
          location: "London",
        },
        "test-ws",
      ),
    ).rejects.toThrow("No ICP criteria prompt configured");
  });

  it("returns needs_website when homepage content is unavailable", async () => {
    const crawlCache = await import("@/lib/icp/crawl-cache");
    const getCrawlMarkdownMock =
      crawlCache.getCrawlMarkdown as ReturnType<typeof vi.fn>;
    getCrawlMarkdownMock.mockResolvedValueOnce(null);

    const result = await scoreStagedPersonIcp(
      {
        firstName: "John",
        lastName: "Doe",
        jobTitle: "CTO",
        company: "Acme Corp",
        companyDomain: "acme.com",
        location: "London",
      },
      "test-ws",
    );

    expect(result.status).toBe("needs_website");
    expect(result.reasoning).toContain("NEEDS_WEBSITE");
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
