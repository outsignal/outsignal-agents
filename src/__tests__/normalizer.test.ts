import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock generateObject before imports
vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

// Mock @ai-sdk/anthropic
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

import { generateObject } from "ai";
import { classifyIndustry } from "@/lib/normalizer/industry";
import { classifyCompanyName } from "@/lib/normalizer/company";
import { classifyJobTitle } from "@/lib/normalizer/job-title";
import { CANONICAL_VERTICALS, SENIORITY_LEVELS } from "@/lib/normalizer/vocabulary";
import { normalizeJobTitle, normalizeLocation, normalizeIndustry, singulariseJobTitle } from "@/lib/normalize";

const mockGenerateObject = generateObject as ReturnType<typeof vi.fn>;

describe("classifyIndustry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for empty/null input", async () => {
    expect(await classifyIndustry("")).toBeNull();
    expect(await classifyIndustry("  ")).toBeNull();
  });

  it("returns exact match from canonical list (case-insensitive)", async () => {
    expect(await classifyIndustry("B2B SaaS")).toBe("B2B SaaS");
    expect(await classifyIndustry("b2b saas")).toBe("B2B SaaS");
    expect(await classifyIndustry("REAL ESTATE")).toBe("Real Estate");
    // No AI call should be made for exact matches
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("calls Claude for ambiguous input and returns canonical value", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { canonical: "Marketing & Advertising", confidence: "high" },
    });
    const result = await classifyIndustry("digital marketing agency");
    expect(result).toBe("Marketing & Advertising");
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("returns null when Claude confidence is low", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { canonical: "Other", confidence: "low" },
    });
    const result = await classifyIndustry("underwater basket weaving");
    expect(result).toBeNull();
  });

  it("returns null on AI error (graceful fallback)", async () => {
    mockGenerateObject.mockRejectedValue(new Error("API down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await classifyIndustry("some industry");
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });
});

describe("classifyCompanyName", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for empty input", async () => {
    expect(await classifyCompanyName("")).toBeNull();
    expect(await classifyCompanyName("  ")).toBeNull();
  });

  it("returns rule-based result for clean mixed-case names (no AI call)", async () => {
    // "Acme" has no legal suffixes, is not all-caps > 4 chars, not garbled
    // normalizeCompanyName("Acme") returns "Acme" (already mixed case)
    const result = await classifyCompanyName("Acme");
    expect(result).toBe("Acme");
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("escalates to Claude for names with legal suffixes", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { canonical: "Microsoft", confidence: "high" },
    });
    const result = await classifyCompanyName("Microsoft Corporation Inc.");
    expect(result).toBe("Microsoft");
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("falls back to rule-based on AI error", async () => {
    mockGenerateObject.mockRejectedValue(new Error("API error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // "GOOGLE LLC" has a noise word (LLC), so it escalates to AI
    // AI fails, so it falls back to rule-based normalizeCompanyName
    const result = await classifyCompanyName("GOOGLE LLC");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
    consoleSpy.mockRestore();
  });

  it("returns AI result for all-caps company names longer than 4 chars", async () => {
    mockGenerateObject.mockResolvedValue({
      object: { canonical: "Accenture", confidence: "high" },
    });
    // "ACCENTURE" is all-caps and > 4 chars — triggers AI path
    const result = await classifyCompanyName("ACCENTURE");
    expect(result).toBe("Accenture");
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });
});

describe("classifyJobTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for empty input", async () => {
    expect(await classifyJobTitle("")).toBeNull();
    expect(await classifyJobTitle("  ")).toBeNull();
  });

  it("detects C-Suite seniority via rule-based path for mixed-case titles", async () => {
    // "Chief Executive Officer" is mixed case — isCleanTitle is true, and matches C-Suite pattern
    const result = await classifyJobTitle("Chief Executive Officer");
    expect(result).not.toBeNull();
    expect(result!.seniority).toBe("C-Suite");
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("detects Director seniority via rule-based path", async () => {
    const result = await classifyJobTitle("Sales Director");
    expect(result).not.toBeNull();
    expect(result!.seniority).toBe("Director");
    expect(result!.canonical).toContain("Sales");
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it("escalates all-caps title to AI (CEO bypasses rule-based fast path)", async () => {
    // "CEO" is all-uppercase — isCleanTitle condition fails (trimmed === trimmed.toUpperCase())
    // so it falls through to AI path
    mockGenerateObject.mockResolvedValue({
      object: {
        canonical: "Chief Executive Officer",
        seniority: "C-Suite",
        confidence: "high",
      },
    });
    const result = await classifyJobTitle("CEO");
    expect(result).not.toBeNull();
    expect(result!.seniority).toBe("C-Suite");
    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
  });

  it("escalates messy titles to Claude", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        canonical: "Chief Technology Officer",
        seniority: "C-Suite",
        confidence: "high",
      },
    });
    const result = await classifyJobTitle("CTO & CO-FOUNDER // TECH LEAD");
    expect(result).not.toBeNull();
    expect(result!.canonical).toBe("Chief Technology Officer");
    expect(result!.seniority).toBe("C-Suite");
  });

  it("returns Unknown seniority on AI failure", async () => {
    mockGenerateObject.mockRejectedValue(new Error("timeout"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await classifyJobTitle("STRATEGIC PARTNERSHIP EVANGELIST #1");
    expect(result).not.toBeNull();
    expect(result!.seniority).toBe("Unknown");
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Rule-based normalisation functions (Phase 57)
// ---------------------------------------------------------------------------

describe("normalizeJobTitle", () => {
  it("normalises C-suite acronyms to uppercase", () => {
    expect(normalizeJobTitle("cto")).toBe("CTO");
    expect(normalizeJobTitle("ceo")).toBe("CEO");
    expect(normalizeJobTitle("cfo")).toBe("CFO");
    expect(normalizeJobTitle("coo")).toBe("COO");
    expect(normalizeJobTitle("cio")).toBe("CIO");
  });

  it("normalises VP prefix with title case", () => {
    expect(normalizeJobTitle("vp of sales")).toBe("VP of Sales");
    expect(normalizeJobTitle("VP MARKETING")).toBe("VP Marketing");
  });

  it("title cases lowercase titles", () => {
    expect(normalizeJobTitle("head of marketing")).toBe("Head of Marketing");
    expect(normalizeJobTitle("sales director")).toBe("Sales Director");
  });

  it("preserves existing mixed case", () => {
    expect(normalizeJobTitle("DevOps Engineer")).toBe("DevOps Engineer");
  });

  it("strips leading/trailing whitespace", () => {
    expect(normalizeJobTitle("  cto  ")).toBe("CTO");
    expect(normalizeJobTitle("  Head of Marketing  ")).toBe("Head of Marketing");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeJobTitle("")).toBe("");
    expect(normalizeJobTitle("  ")).toBe("");
  });

  it("singularises plural job title words (BL-018)", () => {
    expect(normalizeJobTitle("Warehouse Managers")).toBe("Warehouse Manager");
    expect(normalizeJobTitle("Sales Directors")).toBe("Sales Director");
    expect(normalizeJobTitle("Software Engineers")).toBe("Software Engineer");
    expect(normalizeJobTitle("HR Consultants")).toBe("HR Consultant");
    expect(normalizeJobTitle("Business Analysts")).toBe("Business Analyst");
    expect(normalizeJobTitle("Operations Supervisors")).toBe("Operations Supervisor");
    expect(normalizeJobTitle("Project Coordinators")).toBe("Project Coordinator");
    expect(normalizeJobTitle("Marketing Specialists")).toBe("Marketing Specialist");
    expect(normalizeJobTitle("Chief Officers")).toBe("Chief Officer");
    expect(normalizeJobTitle("Account Executives")).toBe("Account Executive");
  });

  it("does not singularise non-title words ending in s", () => {
    expect(normalizeJobTitle("Sales Manager")).toBe("Sales Manager");
    expect(normalizeJobTitle("Business Manager")).toBe("Business Manager");
    expect(normalizeJobTitle("Operations Manager")).toBe("Operations Manager");
  });
});

describe("singulariseJobTitle", () => {
  it("strips trailing s from known plural title words", () => {
    expect(singulariseJobTitle("Warehouse Managers")).toBe("Warehouse Manager");
    expect(singulariseJobTitle("Directors")).toBe("Director");
  });

  it("preserves non-plural words", () => {
    expect(singulariseJobTitle("Sales Manager")).toBe("Sales Manager");
    expect(singulariseJobTitle("CTO")).toBe("CTO");
  });

  it("handles empty/null input", () => {
    expect(singulariseJobTitle("")).toBe("");
  });
});

describe("normalizeLocation", () => {
  it("normalises to title case with country codes preserved", () => {
    expect(normalizeLocation("london, uk")).toBe("London, UK");
    expect(normalizeLocation("NEW YORK")).toBe("New York");
  });

  it("preserves 2-3 letter country codes as uppercase", () => {
    expect(normalizeLocation("dubai, uae")).toBe("Dubai, UAE");
    expect(normalizeLocation("sydney, au")).toBe("Sydney, AU");
  });

  it("strips leading/trailing whitespace", () => {
    expect(normalizeLocation("  london, uk  ")).toBe("London, UK");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeLocation("")).toBe("");
  });
});

describe("normalizeIndustry", () => {
  it("normalises known abbreviations", () => {
    expect(normalizeIndustry("SAAS")).toBe("SaaS");
    expect(normalizeIndustry("saas")).toBe("SaaS");
    expect(normalizeIndustry("b2b")).toBe("B2B");
    expect(normalizeIndustry("B2C")).toBe("B2C");
    expect(normalizeIndustry("ai")).toBe("AI");
    expect(normalizeIndustry("it")).toBe("IT");
  });

  it("title cases remaining words with abbreviations", () => {
    expect(normalizeIndustry("b2b software")).toBe("B2B Software");
    expect(normalizeIndustry("saas platform")).toBe("SaaS Platform");
  });

  it("title cases unknown industries", () => {
    expect(normalizeIndustry("financial services")).toBe("Financial Services");
    expect(normalizeIndustry("REAL ESTATE")).toBe("Real Estate");
  });

  it("strips leading/trailing whitespace", () => {
    expect(normalizeIndustry("  saas  ")).toBe("SaaS");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeIndustry("")).toBe("");
  });
});

describe("vocabulary", () => {
  it("CANONICAL_VERTICALS contains expected entries", () => {
    expect(CANONICAL_VERTICALS).toContain("B2B SaaS");
    expect(CANONICAL_VERTICALS).toContain("Other");
    expect(CANONICAL_VERTICALS.length).toBeGreaterThanOrEqual(20);
  });

  it("SENIORITY_LEVELS contains expected entries", () => {
    expect(SENIORITY_LEVELS).toContain("C-Suite");
    expect(SENIORITY_LEVELS).toContain("Unknown");
    expect(SENIORITY_LEVELS.length).toBe(8);
  });
});
