import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrowMock = vi.fn();
const findManyPersonMock = vi.fn();
const findUniqueMock = vi.fn();
const findManyCompanyMock = vi.fn();
const personUpdateMock = vi.fn();
const personUpdateManyMock = vi.fn();
const updateMock = vi.fn();
const updateManyMock = vi.fn();
const getCrawlMarkdownMock = vi.fn();
const generateObjectMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMock(...args),
      findMany: (...args: unknown[]) => findManyPersonMock(...args),
      update: (...args: unknown[]) => personUpdateMock(...args),
      updateMany: (...args: unknown[]) => personUpdateManyMock(...args),
    },
    personWorkspace: {
      update: (...args: unknown[]) => updateMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
    company: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findMany: (...args: unknown[]) => findManyCompanyMock(...args),
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

import {
  scorePersonIcp,
  scorePersonIcpBatch,
  scoreStagedPersonIcp,
} from "../scorer";
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
  lastNeededWebsiteAt: null,
  workspaces: [{ workspace: "test-workspace" }],
};

describe("ICP scorer runtime guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueOrThrowMock.mockResolvedValue(person);
    findManyPersonMock.mockResolvedValue([person]);
    findUniqueMock.mockResolvedValue(null);
    findManyCompanyMock.mockResolvedValue([]);
    personUpdateMock.mockResolvedValue({});
    personUpdateManyMock.mockResolvedValue({ count: 0 });
    updateMock.mockResolvedValue({});
    updateManyMock.mockResolvedValue({ count: 0 });
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

  it("marks persisted single-person scores as needs_website without calling Anthropic", async () => {
    getCrawlMarkdownMock.mockResolvedValueOnce(null);

    const result = await scorePersonIcp("person_1", "test-workspace", false, {
      icpContext,
    });

    expect(result).toEqual({
      status: "needs_website",
      reasoning: "NEEDS_WEBSITE: company website content unavailable",
      confidence: "low",
      scoringMethod: null,
      persisted: true,
    });
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(personUpdateMock).toHaveBeenCalledWith({
      where: { id: "person_1" },
      data: { lastNeededWebsiteAt: expect.any(Date) },
    });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          icpScore: null,
          icpReasoning: "NEEDS_WEBSITE: company website content unavailable",
          icpConfidence: "low",
        }),
      }),
    );
  });

  it("marks missing-website batch candidates as skipped without invoking Claude", async () => {
    getCrawlMarkdownMock.mockResolvedValueOnce(null);

    const result = await scorePersonIcpBatch(["person_1"], "test-workspace", {
      icpContext,
    });

    expect(result).toEqual({ scored: 0, failed: 0, skipped: 1 });
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(personUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["person_1"] } },
      data: { lastNeededWebsiteAt: expect.any(Date) },
    });
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        personId: { in: ["person_1"] },
        workspace: "test-workspace",
      },
      data: {
        icpScore: null,
        icpReasoning: "NEEDS_WEBSITE: company website content unavailable",
        icpConfidence: "low",
        icpProfileVersionId: null,
      },
    });
  });
});
