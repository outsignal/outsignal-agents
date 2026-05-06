import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceFindUniqueOrThrowMock = vi.fn();
const profileFindUniqueMock = vi.fn();
const campaignFindUniqueMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUniqueOrThrow: (...args: unknown[]) => workspaceFindUniqueOrThrowMock(...args),
    },
    icpProfile: {
      findUnique: (...args: unknown[]) => profileFindUniqueMock(...args),
    },
    campaign: {
      findUnique: (...args: unknown[]) => campaignFindUniqueMock(...args),
    },
  },
}));

vi.mock("@/lib/notify", () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}));

import { IcpResolverError, resolveIcpContext } from "../resolver";

const baseWorkspace = {
  id: "ws-1",
  slug: "workspace-one",
  defaultIcpProfileId: "profile-default",
  icpCriteriaPrompt: "Legacy prompt",
  icpCountries: "United Kingdom",
  icpIndustries: "Recruiting",
  icpCompanySize: "50-1,000 temp workers weekly",
  icpDecisionMakerTitles: "Founder",
  icpKeywords: null,
  icpExclusionCriteria: null,
  icpScoreThreshold: 40,
  _count: { icpProfiles: 1 },
};

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-default",
    workspaceId: "ws-1",
    parentProfileId: null,
    slug: "default",
    name: "Default",
    active: true,
    currentVersion: 1,
    workspace: { slug: "workspace-one" },
    versions: [
      {
        id: "version-1",
        profileId: "profile-default",
        version: 1,
        description: "Profile prompt",
        targetTitles: ["Founder", "CEO"],
        locations: ["United Kingdom"],
        industries: ["Transport"],
        companySizes: ["11-50"],
        scoringRubric: { rubric: true },
      },
    ],
    ...overrides,
  };
}

function mockProfilesById(records: Array<ReturnType<typeof profile>>) {
  const byId = new Map(records.map((record) => [record.id, record]));
  profileFindUniqueMock.mockImplementation(
    async (args: { where: { id: string } }) => byId.get(args.where.id) ?? null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  workspaceFindUniqueOrThrowMock.mockResolvedValue(baseWorkspace);
  profileFindUniqueMock.mockResolvedValue(profile());
  campaignFindUniqueMock.mockResolvedValue(null);
  notifyMock.mockResolvedValue(undefined);
});

describe("resolveIcpContext", () => {
  it("resolves an explicit active profile and captures the current version snapshot", async () => {
    const context = await resolveIcpContext({
      workspaceId: "ws-1",
      icpProfileId: "profile-default",
    });

    expect(context.source).toBe("explicit");
    expect(context.profileId).toBe("profile-default");
    expect(context.versionId).toBe("version-1");
    expect(context.snapshot?.description).toBe("Profile prompt");
    expect(context.snapshot?.targetTitles).toEqual(["Founder", "CEO"]);
    expect(context.snapshot?.lineage).toEqual([
      expect.objectContaining({
        profileId: "profile-default",
        versionId: "version-1",
        role: "leaf",
      }),
    ]);
    expect(context.warnings).toEqual([]);
  });

  it("merges parent and child profiles into a frozen lineage snapshot", async () => {
    const parent = profile({
      id: "profile-parent",
      slug: "universal",
      name: "Universal",
      versions: [
        {
          id: "version-parent",
          profileId: "profile-parent",
          version: 1,
          description: "Universal weekly payroll criteria",
          targetTitles: ["Owner", "Operations Manager"],
          locations: ["UK"],
          industries: ["Logistics", "Transport"],
          companySizes: ["5-100"],
          scoringRubric: {
            hardExclusions: ["Recruitment agency"],
            preferredSignals: ["Weekly payroll"],
            scoreBands: { parent: true },
          },
        },
      ],
    });
    const child = profile({
      id: "profile-child",
      slug: "transport",
      name: "Transport",
      parentProfileId: "profile-parent",
      versions: [
        {
          id: "version-child",
          profileId: "profile-child",
          version: 1,
          description: "Transport vertical criteria",
          targetTitles: ["Fleet Manager", "Operations Manager"],
          locations: ["United Kingdom"],
          industries: ["Logistics"],
          companySizes: ["50-200"],
          scoringRubric: {
            hardExclusions: ["Single-vehicle owner-operator"],
            negativeSignals: ["Passenger-only transport"],
            scoreBands: { child: true },
          },
        },
      ],
    });
    mockProfilesById([parent, child]);

    const context = await resolveIcpContext({
      workspaceId: "ws-1",
      icpProfileId: "profile-child",
    });

    expect(context.profileId).toBe("profile-child");
    expect(context.versionId).toBe("version-child");
    expect(context.snapshot).toMatchObject({
      profileId: "profile-child",
      profileSlug: "transport",
      versionId: "version-child",
      targetTitles: ["Owner", "Operations Manager", "Fleet Manager"],
      locations: ["United Kingdom"],
      industries: ["Logistics"],
      companySizes: ["50-100"],
    });
    expect(context.snapshot?.description).toBe(
      [
        "UNIVERSAL CRITERIA:\nUniversal weekly payroll criteria",
        "VERTICAL CRITERIA:\nTransport vertical criteria",
      ].join("\n\n"),
    );
    expect(context.snapshot?.lineage).toEqual([
      expect.objectContaining({
        profileId: "profile-parent",
        versionId: "version-parent",
        role: "parent",
      }),
      expect.objectContaining({
        profileId: "profile-child",
        versionId: "version-child",
        role: "leaf",
      }),
    ]);
    expect(context.snapshot?.scoringRubric).toMatchObject({
      hardExclusions: ["Recruitment agency", "Single-vehicle owner-operator"],
      preferredSignals: ["Weekly payroll"],
      negativeSignals: ["Passenger-only transport"],
      scoreBands: { child: true },
      mergedFrom: [
        expect.objectContaining({ profileId: "profile-parent" }),
        expect.objectContaining({ profileId: "profile-child" }),
      ],
    });
  });

  it("rejects an explicit profile from another workspace at the resolver layer", async () => {
    profileFindUniqueMock.mockResolvedValue(
      profile({ workspaceId: "ws-2", workspace: { slug: "workspace-two" } }),
    );

    await expect(
      resolveIcpContext({ workspaceId: "ws-1", icpProfileId: "profile-other" }),
    ).rejects.toMatchObject({
      name: "IcpResolverError",
      code: "EXPLICIT_PROFILE_WRONG_WORKSPACE",
    } satisfies Partial<IcpResolverError>);
  });

  it("rejects an explicit inactive profile", async () => {
    profileFindUniqueMock.mockResolvedValue(profile({ active: false }));

    await expect(
      resolveIcpContext({ workspaceId: "ws-1", icpProfileId: "profile-default" }),
    ).rejects.toMatchObject({
      name: "IcpResolverError",
      code: "EXPLICIT_PROFILE_INACTIVE",
    } satisfies Partial<IcpResolverError>);
  });

  it("rejects an explicit profile whose parent belongs to another workspace", async () => {
    const child = profile({
      id: "profile-child",
      parentProfileId: "profile-parent",
    });
    const parent = profile({
      id: "profile-parent",
      workspaceId: "ws-2",
      workspace: { slug: "workspace-two" },
    });
    mockProfilesById([child, parent]);

    await expect(
      resolveIcpContext({ workspaceId: "ws-1", icpProfileId: "profile-child" }),
    ).rejects.toMatchObject({
      name: "IcpResolverError",
      code: "EXPLICIT_PROFILE_PARENT_WRONG_WORKSPACE",
    } satisfies Partial<IcpResolverError>);
  });

  it("rejects explicit hierarchy cycles", async () => {
    const child = profile({
      id: "profile-child",
      parentProfileId: "profile-parent",
    });
    const parent = profile({
      id: "profile-parent",
      parentProfileId: "profile-child",
    });
    mockProfilesById([child, parent]);

    await expect(
      resolveIcpContext({ workspaceId: "ws-1", icpProfileId: "profile-child" }),
    ).rejects.toMatchObject({
      name: "IcpResolverError",
      code: "EXPLICIT_PROFILE_HIERARCHY_CYCLE",
    } satisfies Partial<IcpResolverError>);
  });

  it("rejects explicit hierarchies deeper than three profiles", async () => {
    const leaf = profile({ id: "profile-leaf", parentProfileId: "profile-level-2" });
    const level2 = profile({ id: "profile-level-2", parentProfileId: "profile-level-1" });
    const level1 = profile({ id: "profile-level-1", parentProfileId: "profile-root" });
    const root = profile({ id: "profile-root" });
    mockProfilesById([leaf, level2, level1, root]);

    await expect(
      resolveIcpContext({ workspaceId: "ws-1", icpProfileId: "profile-leaf" }),
    ).rejects.toMatchObject({
      name: "IcpResolverError",
      code: "EXPLICIT_PROFILE_HIERARCHY_DEPTH_EXCEEDED",
    } satisfies Partial<IcpResolverError>);
  });

  it("rejects explicit hierarchies with incompatible intersected scope", async () => {
    const parent = profile({
      id: "profile-parent",
      versions: [
        {
          id: "version-parent",
          profileId: "profile-parent",
          version: 1,
          description: "Universal",
          targetTitles: null,
          locations: ["United Kingdom"],
          industries: ["Transport"],
          companySizes: ["5-100"],
          scoringRubric: null,
        },
      ],
    });
    const child = profile({
      id: "profile-child",
      parentProfileId: "profile-parent",
      versions: [
        {
          id: "version-child",
          profileId: "profile-child",
          version: 1,
          description: "Recruitment",
          targetTitles: null,
          locations: ["United Kingdom"],
          industries: ["Recruitment"],
          companySizes: ["5-100"],
          scoringRubric: null,
        },
      ],
    });
    mockProfilesById([parent, child]);

    await expect(
      resolveIcpContext({ workspaceId: "ws-1", icpProfileId: "profile-child" }),
    ).rejects.toMatchObject({
      name: "IcpResolverError",
      code: "EXPLICIT_PROFILE_HIERARCHY_SCOPE_CONFLICT",
    } satisfies Partial<IcpResolverError>);
  });

  it("falls through from an inactive campaign profile to the workspace default", async () => {
    campaignFindUniqueMock.mockResolvedValue({
      id: "campaign-1",
      workspaceSlug: "workspace-one",
      icpProfileId: "profile-campaign",
    });
    profileFindUniqueMock
      .mockResolvedValueOnce(profile({ id: "profile-campaign", active: false }))
      .mockResolvedValueOnce(profile());

    const context = await resolveIcpContext({
      workspaceId: "ws-1",
      campaignId: "campaign-1",
    });

    expect(context.source).toBe("workspaceDefault");
    expect(context.warnings.map((w) => w.code)).toContain("WARN_INACTIVE_CAMPAIGN_PROFILE");
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("alerts and falls back to legacy when the default profile parent is inactive", async () => {
    const child = profile({
      id: "profile-default",
      parentProfileId: "profile-parent",
    });
    const parent = profile({
      id: "profile-parent",
      active: false,
    });
    mockProfilesById([child, parent]);

    const context = await resolveIcpContext({ workspaceId: "ws-1" });

    expect(context.source).toBe("legacy");
    expect(context.warnings.map((w) => w.code)).toContain(
      "WARN_PROFILE_PARENT_INACTIVE",
    );
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        severity: "error",
        title: expect.stringContaining("WARN_PROFILE_PARENT_INACTIVE"),
      }),
    );
  });

  it("alerts and falls back to legacy when the default profile is inactive", async () => {
    profileFindUniqueMock.mockResolvedValue(profile({ active: false }));

    const context = await resolveIcpContext({ workspaceId: "ws-1" });

    expect(context.source).toBe("legacy");
    expect(context.snapshot?.description).toBe("Legacy prompt");
    expect(context.warnings.map((w) => w.code)).toContain("WARN_INACTIVE_DEFAULT");
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        severity: "error",
        title: expect.stringContaining("WARN_INACTIVE_DEFAULT"),
      }),
    );
  });

  it("alerts and falls back when a resolved profile has no current version", async () => {
    profileFindUniqueMock.mockResolvedValue(profile({ versions: [] }));

    const context = await resolveIcpContext({ workspaceId: "ws-1" });

    expect(context.source).toBe("legacy");
    expect(context.warnings.map((w) => w.code)).toContain("WARN_PROFILE_NO_VERSION");
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("WARN_PROFILE_NO_VERSION"),
      }),
    );
  });

  it("synthesises a legacy snapshot and warns when profiles exist but none resolve", async () => {
    workspaceFindUniqueOrThrowMock.mockResolvedValue({
      ...baseWorkspace,
      defaultIcpProfileId: null,
      _count: { icpProfiles: 1 },
    });

    const context = await resolveIcpContext({ workspaceId: "ws-1" });

    expect(context.source).toBe("legacy");
    expect(context.profileId).toBeNull();
    expect(context.versionId).toBeNull();
    expect(context.snapshot?.scoringRubric).toMatchObject({
      icpCompanySize: "50-1,000 temp workers weekly",
    });
    expect(context.warnings.map((w) => w.code)).toContain(
      "WARN_LEGACY_FALLBACK_DESPITE_PROFILES",
    );
  });
});
