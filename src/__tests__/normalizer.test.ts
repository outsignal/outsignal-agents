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
