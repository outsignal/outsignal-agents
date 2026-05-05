import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrowMock = vi.fn();
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const getCrawlMarkdownMock = vi.fn();
const generateObjectMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMock(...args),
    },
    personWorkspace: {
      update: (...args: unknown[]) => updateMock(...args),
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

import { scorePersonIcp, scoreStagedPersonIcp } from "../scorer";
import type { IcpContext } from "../resolver";

const icpContext: IcpContext = {
  source: "legacy",
  profileId: null,
  versionId: null,
  snapshot: {
    profileId: "legacy",
    profileName: "Legacy",
    profileSlug: "legacy",
    versionId: "legacy",
    version: 1,
    description: "Score transport operations leaders",
    targetTitles: null,
    locations: null,
    industries: null,
    companySizes: null,
    scoringRubric: null,
  },
  warnings: [],
};

const stagedInput = {
  firstName: "Ada",
  lastName: "Lovelace",
  jobTitle: "Operations Manager",
  company: "Analytical Logistics",
  companyDomain: "analytical.example",
  location: "London",
};

const person = {
  id: "person_1",
  firstName: "Ada",
  lastName: "Lovelace",
  jobTitle: "Operations Manager",
  headline: null,
  skills: null,
  jobHistory: null,
  profileSummary: null,
  education: null,
  certifications: null,
  languages: null,
  company: "Analytical Logistics",
  vertical: null,
  location: "London",
  locationCity: null,
  locationState: null,
  locationCountry: null,
  seniority: null,
  enrichmentData: null,
  companyDomain: "analytical.example",
  workspaces: [{ workspace: "test-workspace" }],
};

describe("ICP scorer runtime guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueOrThrowMock.mockResolvedValue(person);
    findUniqueMock.mockResolvedValue(null);
    updateMock.mockResolvedValue({});
    getCrawlMarkdownMock.mockResolvedValue("Analytical Logistics homepage");
  });

  it("clamps out-of-range single staged scores", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateObjectMock.mockResolvedValue({
      object: {
        score: 142,
        reasoning: "Good fit, but the model overshot.",
        confidence: "high",
      },
    });

    const result = await scoreStagedPersonIcp(stagedInput, "test-workspace", {
      icpContext,
    });

    expect(result.status).toBe("scored");
    if (result.status !== "scored") {
      throw new Error("expected scored result");
    }
    expect(result.score).toBe(100);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("clamped to 100"),
    );
    warnSpy.mockRestore();
  });

  it("rejects NaN single staged scores", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateObjectMock.mockResolvedValue({
      object: {
        score: Number.NaN,
        reasoning: "Malformed score",
        confidence: "low",
      },
    });

    await expect(
      scoreStagedPersonIcp(stagedInput, "test-workspace", { icpContext }),
    ).rejects.toThrow("invalid score");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("returned non-finite score"),
    );
    warnSpy.mockRestore();
  });

  it("clamps out-of-range persisted single-person scores before storing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateObjectMock.mockResolvedValue({
      object: {
        score: 142,
        reasoning: "Strong fit, but the model overshot.",
        confidence: "medium",
      },
    });

    const result = await scorePersonIcp("person_1", "test-workspace", false, {
      icpContext,
    });

    expect(result).toMatchObject({
      score: 100,
      reasoning: "Strong fit, but the model overshot.",
      confidence: "medium",
      persisted: true,
    });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ icpScore: 100 }),
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("clamped to 100"),
    );
    warnSpy.mockRestore();
  });

  it("rejects NaN persisted single-person scores without storing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    generateObjectMock.mockResolvedValue({
      object: {
        score: Number.NaN,
        reasoning: "Malformed score",
        confidence: "low",
      },
    });

    await expect(
      scorePersonIcp("person_1", "test-workspace", false, { icpContext }),
    ).rejects.toThrow("invalid score");
    expect(updateMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("returned non-finite score for person_1"),
    );
    warnSpy.mockRestore();
  });
});
