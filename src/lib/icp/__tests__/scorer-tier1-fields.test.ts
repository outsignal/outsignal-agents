import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrowMock = vi.fn();
const findUniqueMock = vi.fn();
const getCrawlMarkdownMock = vi.fn();
const generateObjectMock = vi.fn();

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

vi.mock("@/lib/icp/crawl-cache", () => ({
  getCrawlMarkdown: (...args: unknown[]) => getCrawlMarkdownMock(...args),
}));

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

import { buildScoringPrompt, scoreStagedPersonIcp } from "../scorer";

describe("buildScoringPrompt Tier 1 fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders high-value person and company fields", () => {
    const prompt = buildScoringPrompt({
      person: {
        firstName: "Ada",
        lastName: "Lovelace",
        jobTitle: "Founder",
        headline: "Founder building recruitment automation",
        company: "Analytical Talent",
        vertical: "Staffing and Recruiting",
        location: "Flat location should not win",
        locationCity: "London",
        locationState: "England",
        locationCountry: "United Kingdom",
        seniority: "Founder",
        enrichmentData: JSON.stringify({ seniority: "Legacy Senior" }),
      },
      company: {
        headcount: 42,
        industry: "Recruiting",
        description: "Specialist staffing consultancy",
        yearFounded: 2019,
        revenue: "$1M-$10M",
        technologies: {
          technology_names: [
            "HubSpot",
            "Salesforce",
            "LinkedIn Insight Tag",
            "Google Analytics",
            "Microsoft 365",
            "Webflow",
            "Intercom",
            "Zapier",
            "Extra Tech",
          ],
        },
        fundingTotal: BigInt(1234567),
      },
      websiteMarkdown: "Homepage copy",
    });

    expect(prompt).toContain("- Headline: Founder building recruitment automation");
    expect(prompt).toContain("- Location: London, England, United Kingdom");
    expect(prompt).toContain("- Seniority: Founder");
    expect(prompt).not.toContain("Legacy Senior");
    expect(prompt).toContain("- Revenue: $1M-$10M");
    expect(prompt).toContain(
      "- Technologies: HubSpot, Salesforce, LinkedIn Insight Tag, Google Analytics, Microsoft 365, Webflow, Intercom, Zapier",
    );
    expect(prompt).not.toContain("Extra Tech");
    expect(prompt).toContain("- Funding: $1,234,567");
  });

  it("falls back to legacy seniority JSON and flat location", () => {
    const prompt = buildScoringPrompt({
      person: {
        firstName: "Grace",
        lastName: "Hopper",
        jobTitle: "CTO",
        headline: null,
        company: "Compiler Co",
        vertical: null,
        location: "Manchester, UK",
        locationCity: null,
        locationState: null,
        locationCountry: null,
        seniority: null,
        enrichmentData: JSON.stringify({ seniorityLevel: "Executive" }),
      },
      company: {
        headcount: null,
        industry: null,
        description: null,
        yearFounded: null,
        revenue: null,
        technologies: null,
        fundingTotal: null,
      },
      websiteMarkdown: "Homepage copy",
    });

    expect(prompt).toContain("- Headline: Unknown");
    expect(prompt).toContain("- Location: Manchester, UK");
    expect(prompt).toContain("- Seniority: Executive");
    expect(prompt).toContain("- Revenue: Unknown");
    expect(prompt).toContain("- Technologies: Unknown");
    expect(prompt).toContain("- Funding: Unknown");
  });

  it("renders Unknown for missing nullable fields without crashing", () => {
    const prompt = buildScoringPrompt({
      person: {
        firstName: null,
        lastName: null,
        jobTitle: null,
        headline: null,
        company: null,
        vertical: null,
        location: null,
        locationCity: null,
        locationState: null,
        locationCountry: null,
        seniority: null,
        enrichmentData: "{not-json",
      },
      company: null,
      websiteMarkdown: null,
    });

    expect(prompt).toContain("- Job Title: Unknown");
    expect(prompt).toContain("- Headline: Unknown");
    expect(prompt).toContain("- Location: Unknown");
    expect(prompt).toContain("- Seniority: Unknown");
    expect(prompt).toContain("- No company record found");
  });
});

describe("scoreStagedPersonIcp website gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueOrThrowMock.mockResolvedValue({
      slug: "test-workspace",
      icpCriteriaPrompt: "Score recruiting founders",
    });
  });

  it("keeps the website markdown gate before LLM scoring", async () => {
    getCrawlMarkdownMock.mockResolvedValue(null);

    const result = await scoreStagedPersonIcp(
      {
        firstName: "Ada",
        lastName: "Lovelace",
        jobTitle: "Founder",
        company: "Analytical Talent",
        companyDomain: "analytical.example",
        location: "London",
      },
      "test-workspace",
    );

    expect(result).toEqual({
      status: "needs_website",
      reasoning: "NEEDS_WEBSITE: company website content unavailable",
      confidence: "low",
      scoringMethod: null,
    });
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
