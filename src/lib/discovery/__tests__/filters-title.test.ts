import { beforeEach, describe, expect, it, vi } from "vitest";

const discoveredPersonFindManyMock = vi.fn();
const discoveredPersonCreateManyMock = vi.fn();
const discoveryRunUpsertMock = vi.fn();
const discoveryRunUpdateMock = vi.fn();
const discoveryRejectionLogCreateManyMock = vi.fn();
const workspaceFindUniqueOrThrowMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    discoveredPerson: {
      findMany: (...args: unknown[]) => discoveredPersonFindManyMock(...args),
      createMany: (...args: unknown[]) => discoveredPersonCreateManyMock(...args),
    },
    discoveryRun: {
      upsert: (...args: unknown[]) => discoveryRunUpsertMock(...args),
      update: (...args: unknown[]) => discoveryRunUpdateMock(...args),
    },
    discoveryRejectionLog: {
      createMany: (...args: unknown[]) =>
        discoveryRejectionLogCreateManyMock(...args),
    },
    workspace: {
      findUniqueOrThrow: (...args: unknown[]) => workspaceFindUniqueOrThrowMock(...args),
    },
  },
}));

import {
  applyDiscoveryFilters,
  logDiscoveryTitleRejections,
  titleMatchesTarget,
} from "../filters";
import { stageDiscoveredPeople } from "../staging";
import type { DiscoveredPersonResult } from "../types";

const targetTitles = [
  "Operations Manager",
  "Compliance Manager",
  "Head of Operations",
];

function person(jobTitle: string | null): DiscoveredPersonResult {
  return {
    firstName: "Alex",
    lastName: jobTitle ?? "Missing",
    jobTitle: jobTitle ?? undefined,
    company: "Acme Transport",
    companyDomain: "acme.example",
    linkedinUrl: jobTitle
      ? `https://linkedin.com/in/${jobTitle.replace(/\W+/g, "-")}`
      : undefined,
  };
}

describe("strict discovery title filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    discoveredPersonFindManyMock.mockResolvedValue([]);
    discoveredPersonCreateManyMock.mockResolvedValue({ count: 1 });
    discoveryRunUpsertMock.mockResolvedValue({});
    discoveryRunUpdateMock.mockResolvedValue({});
    discoveryRejectionLogCreateManyMock.mockResolvedValue({ count: 1 });
    workspaceFindUniqueOrThrowMock.mockResolvedValue({ id: "workspace_1" });
  });

  it.each([
    ["Operations Manager", true],
    ["operations manager", true],
    ["Senior Operations Manager", true],
    ["Operations Manager — UK", true],
    ["Head of Operations", true],
    ["Operations", false],
    ["Manager", false],
    ["Head", false],
    ["Compliance", false],
    ["Director", false],
    ["Senior", false],
    ["Manager of Operations", true],
    ["Operations of Manager", false],
    ["Head of Fleet Operations", true],
    ["Compliance and Operations Manager", true],
    ["Crane operator", false],
    ["Operator", false],
    ["Operations Specialist", false],
    ["Office Manager", false],
    [null, false],
    [undefined, false],
    ["", false],
    ["  ", false],
    ["Compliance Officer", false],
  ])("matches %s => %s", (discoveredTitle, expected) => {
    expect(titleMatchesTarget(discoveredTitle, targetTitles)).toBe(expected);
  });

  it("allows ordered head-of variants without admitting unrelated operators", () => {
    expect(titleMatchesTarget("Head of Fleet Operations", targetTitles)).toBe(true);
    expect(titleMatchesTarget("Crane operator", targetTitles)).toBe(false);
  });

  it("filters out-of-scope provider results before staging and logs the rejection", async () => {
    const people = [
      person("Operations Manager"),
      person("Crane operator"),
    ];
    const filtered = applyDiscoveryFilters(people, undefined, undefined, {
      targetTitles,
    });

    await logDiscoveryTitleRejections({
      provider: "aiark",
      workspaceSlug: "1210-solutions",
      discoveryRunId: "run_1",
      icpProfileId: "profile_transport",
      targetTitles,
      rejections: filtered.titleRejections,
    });

    await stageDiscoveredPeople({
      people: filtered.passed,
      discoverySource: "aiark",
      workspaceSlug: "1210-solutions",
      discoveryRunId: "run_1",
    });

    expect(filtered.titleFiltered).toBe(1);
    expect(discoveryRejectionLogCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          provider: "aiark",
          workspaceSlug: "1210-solutions",
          discoveryRunId: "run_1",
          icpProfileId: "profile_transport",
          originalTitle: "Crane operator",
          targetTitles,
          reason: "out_of_scope_title",
        }),
      ],
    });
    expect(discoveredPersonCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            jobTitle: "Operations Manager",
            discoverySource: "aiark",
          }),
        ],
      }),
    );
  });
});
