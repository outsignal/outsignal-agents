import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrowMock = vi.fn();
const findManyMock = vi.fn();
const getCrawlMarkdownMock = vi.fn();
const generateObjectMock = vi.fn();
const resolveIcpContextForWorkspaceSlugMock = vi.fn();

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

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
  };
});

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-model"),
}));

vi.mock("@/lib/icp/resolver", () => ({
  resolveIcpContextForWorkspaceSlug: (...args: unknown[]) =>
    resolveIcpContextForWorkspaceSlugMock(...args),
}));

import { asSchema } from "ai";
import { ClassificationSchema } from "@/lib/classification/classify-reply";
import { icpCriteriaSchema } from "../extract-criteria";
import { InsightSchema } from "@/lib/insights/types";
import { CompanyNameSchema } from "@/lib/normalizer/company";
import { JobTitleSchema } from "@/lib/normalizer/job-title";
import {
  BatchIcpScoreSchema,
  IcpScoreSchema,
  normalizeBatchIcpScoreEntry,
  scoreStagedPersonIcpBatch,
} from "../scorer";

const REJECTED_SCHEMA_KEYS = [
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
] as const;

function collectSchemaKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaKeys(item, keys);
    return keys;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      collectSchemaKeys(child, keys);
    }
  }
  return keys;
}

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
    resolveIcpContextForWorkspaceSlugMock.mockResolvedValue({
      source: "legacy",
      profileId: null,
      versionId: null,
      snapshot: {
        description: "Prefer B2B SaaS operators at 50-500 employee companies",
      },
      warnings: [],
      workspaceId: "workspace_1",
    });
  });

  it.each([
    ["IcpScoreSchema", IcpScoreSchema],
    ["BatchIcpScoreSchema", BatchIcpScoreSchema],
    ["icpCriteriaSchema", icpCriteriaSchema],
    ["InsightSchema", InsightSchema],
    ["CompanyNameSchema", CompanyNameSchema],
    ["JobTitleSchema", JobTitleSchema],
    ["ClassificationSchema", ClassificationSchema],
  ])("serializes %s without Anthropic-rejected constraint keys", async (_name, schema) => {
    const jsonSchema = await asSchema<unknown>(schema).jsonSchema;
    const schemaKeys = collectSchemaKeys(jsonSchema);

    for (const key of REJECTED_SCHEMA_KEYS) {
      expect(schemaKeys.has(key)).toBe(false);
    }
  });

  it("clamps out-of-range batch scores after parsing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      normalizeBatchIcpScoreEntry({
        personId: "dp_low",
        score: -12,
        reasoning: "Too low",
        confidence: "medium",
      }),
    ).toEqual({
      personId: "dp_low",
      score: 0,
      reasoning: "Too low",
      confidence: "medium",
    });

    expect(
      normalizeBatchIcpScoreEntry({
        personId: "dp_high",
        score: 142,
        reasoning: "Too high",
        confidence: "high",
      }),
    ).toEqual({
      personId: "dp_high",
      score: 100,
      reasoning: "Too high",
      confidence: "high",
    });

    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
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

  it("uses the post-parse guard for Anthropic batch results", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateObjectMock.mockResolvedValue({
      object: [
        {
          personId: "dp_1",
          score: 108,
          reasoning: "Strong fit but model overshot the range",
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
      score: 100,
      reasoning: "Strong fit but model overshot the range",
      confidence: "high",
      scoringMethod: "firecrawl+llm",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("clamped to 100"),
    );
    warnSpy.mockRestore();
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
