import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";

export type IcpContextSource =
  | "explicit"
  | "campaign"
  | "workspaceDefault"
  | "legacy";

export type IcpResolverWarningCode =
  | "WARN_INACTIVE_DEFAULT"
  | "WARN_INACTIVE_CAMPAIGN_PROFILE"
  | "WARN_PROFILE_NO_VERSION"
  | "WARN_LEGACY_FALLBACK_DESPITE_PROFILES";

export type IcpResolverErrorCode =
  | "EXPLICIT_PROFILE_NOT_FOUND"
  | "EXPLICIT_PROFILE_WRONG_WORKSPACE"
  | "EXPLICIT_PROFILE_INACTIVE"
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_WRONG_WORKSPACE";

export type IcpResolverWarning = {
  code: IcpResolverWarningCode;
  message: string;
  profileId?: string;
  workspaceId: string;
};

export type IcpProfileSnapshot = {
  profileId: string;
  profileName: string;
  profileSlug: string;
  versionId: string;
  version: number;
  description: string;
  targetTitles: string[] | null;
  locations: string[] | null;
  industries: string[] | null;
  companySizes: string[] | null;
  scoringRubric: unknown;
};

export type IcpContext = {
  source: IcpContextSource;
  profileId: string | null;
  versionId: string | null;
  snapshot: IcpProfileSnapshot | null;
  warnings: IcpResolverWarning[];
};

export class IcpResolverError extends Error {
  constructor(
    public readonly code: IcpResolverErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IcpResolverError";
  }
}

type WorkspaceForIcp = Awaited<ReturnType<typeof fetchWorkspaceForIcp>>;
type ProfileCandidate = NonNullable<
  Awaited<ReturnType<typeof fetchProfileCandidate>>
>;

const P1_WARNING_CODES = new Set<IcpResolverWarningCode>([
  "WARN_INACTIVE_DEFAULT",
  "WARN_PROFILE_NO_VERSION",
]);

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : null;
}

async function fetchWorkspaceForIcp(workspaceId: string) {
  return prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      id: true,
      slug: true,
      defaultIcpProfileId: true,
      icpCriteriaPrompt: true,
      icpCountries: true,
      icpIndustries: true,
      icpCompanySize: true,
      icpDecisionMakerTitles: true,
      icpKeywords: true,
      icpExclusionCriteria: true,
      icpScoreThreshold: true,
      _count: { select: { icpProfiles: true } },
    },
  });
}

async function fetchProfileCandidate(profileId: string) {
  return prisma.icpProfile.findUnique({
    where: { id: profileId },
    include: {
      versions: true,
      workspace: { select: { slug: true } },
    },
  });
}

function addWarning(
  warnings: IcpResolverWarning[],
  warning: IcpResolverWarning,
): void {
  warnings.push(warning);
  console.warn(`[icp-resolver] ${warning.code}: ${warning.message}`);
}

async function emitResolverAlerts(
  workspace: { id: string; slug: string },
  warnings: IcpResolverWarning[],
): Promise<void> {
  for (const warning of warnings) {
    if (!P1_WARNING_CODES.has(warning.code)) continue;
    await notify({
      type: "error",
      severity: "error",
      title: `P1 ICP resolver warning: ${warning.code}`,
      message: warning.message,
      workspaceSlug: workspace.slug,
      metadata: {
        code: warning.code,
        profileId: warning.profileId ?? null,
        workspaceId: warning.workspaceId,
      },
    });
  }
}

function snapshotFromProfile(profile: ProfileCandidate): IcpProfileSnapshot | null {
  const version = profile.versions.find((v) => v.version === profile.currentVersion);
  if (!version) return null;

  return {
    profileId: profile.id,
    profileName: profile.name,
    profileSlug: profile.slug,
    versionId: version.id,
    version: version.version,
    description: version.description,
    targetTitles: asStringArray(version.targetTitles),
    locations: asStringArray(version.locations),
    industries: asStringArray(version.industries),
    companySizes: asStringArray(version.companySizes),
    scoringRubric: version.scoringRubric,
  };
}

function legacyDescription(workspace: WorkspaceForIcp): string | null {
  const candidates = [
    workspace.icpCriteriaPrompt,
    workspace.icpDecisionMakerTitles,
    workspace.icpIndustries,
    workspace.icpCountries,
    workspace.icpCompanySize,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function legacySnapshot(workspace: WorkspaceForIcp): IcpProfileSnapshot | null {
  const description = legacyDescription(workspace);
  if (!description) return null;

  return {
    profileId: "legacy",
    profileName: `${workspace.slug} legacy ICP`,
    profileSlug: "legacy",
    versionId: "legacy",
    version: 0,
    description,
    targetTitles: null,
    locations: null,
    industries: null,
    companySizes: null,
    scoringRubric: {
      legacySource: "Workspace",
      icpCriteriaPrompt: workspace.icpCriteriaPrompt,
      icpCountries: workspace.icpCountries,
      icpIndustries: workspace.icpIndustries,
      icpCompanySize: workspace.icpCompanySize,
      icpDecisionMakerTitles: workspace.icpDecisionMakerTitles,
      icpKeywords: workspace.icpKeywords,
      icpExclusionCriteria: workspace.icpExclusionCriteria,
      icpScoreThreshold: workspace.icpScoreThreshold,
    },
  };
}

async function resolveProfile(
  args: {
    workspace: WorkspaceForIcp;
    profileId: string;
    source: Exclude<IcpContextSource, "legacy">;
    explicit: boolean;
    warnings: IcpResolverWarning[];
  },
): Promise<IcpContext | null> {
  const profile = await fetchProfileCandidate(args.profileId);

  if (!profile) {
    if (args.explicit) {
      throw new IcpResolverError(
        "EXPLICIT_PROFILE_NOT_FOUND",
        `ICP profile '${args.profileId}' does not exist.`,
      );
    }
    return null;
  }

  if (profile.workspaceId !== args.workspace.id) {
    if (args.explicit) {
      throw new IcpResolverError(
        "EXPLICIT_PROFILE_WRONG_WORKSPACE",
        `ICP profile '${args.profileId}' belongs to workspace '${profile.workspace.slug}', not '${args.workspace.slug}'.`,
      );
    }
    return null;
  }

  if (!profile.active) {
    if (args.explicit) {
      throw new IcpResolverError(
        "EXPLICIT_PROFILE_INACTIVE",
        `ICP profile '${args.profileId}' is inactive and cannot be used explicitly.`,
      );
    }

    const code =
      args.source === "campaign"
        ? "WARN_INACTIVE_CAMPAIGN_PROFILE"
        : "WARN_INACTIVE_DEFAULT";
    addWarning(args.warnings, {
      code,
      workspaceId: args.workspace.id,
      profileId: profile.id,
      message: `${args.source} ICP profile '${profile.id}' is inactive; falling back.`,
    });
    return null;
  }

  const snapshot = snapshotFromProfile(profile);
  if (!snapshot) {
    addWarning(args.warnings, {
      code: "WARN_PROFILE_NO_VERSION",
      workspaceId: args.workspace.id,
      profileId: profile.id,
      message: `ICP profile '${profile.id}' has currentVersion=${profile.currentVersion}, but no matching version row; falling back.`,
    });
    return null;
  }

  return {
    source: args.source,
    profileId: profile.id,
    versionId: snapshot.versionId,
    snapshot,
    warnings: args.warnings,
  };
}

export async function resolveIcpContext(args: {
  workspaceId: string;
  campaignId?: string;
  icpProfileId?: string;
}): Promise<IcpContext> {
  const workspace = await fetchWorkspaceForIcp(args.workspaceId);
  const warnings: IcpResolverWarning[] = [];

  if (args.icpProfileId) {
    const explicit = await resolveProfile({
      workspace,
      profileId: args.icpProfileId,
      source: "explicit",
      explicit: true,
      warnings,
    });
    if (explicit) return explicit;
  }

  if (args.campaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: args.campaignId },
      select: { id: true, workspaceSlug: true, icpProfileId: true },
    });
    if (!campaign) {
      throw new IcpResolverError(
        "CAMPAIGN_NOT_FOUND",
        `Campaign '${args.campaignId}' does not exist.`,
      );
    }
    if (campaign.workspaceSlug !== workspace.slug) {
      throw new IcpResolverError(
        "CAMPAIGN_WRONG_WORKSPACE",
        `Campaign '${args.campaignId}' belongs to workspace '${campaign.workspaceSlug}', not '${workspace.slug}'.`,
      );
    }

    if (campaign.icpProfileId) {
      const campaignContext = await resolveProfile({
        workspace,
        profileId: campaign.icpProfileId,
        source: "campaign",
        explicit: false,
        warnings,
      });
      if (campaignContext) {
        await emitResolverAlerts(workspace, warnings);
        return campaignContext;
      }
    }
  }

  if (workspace.defaultIcpProfileId) {
    const defaultContext = await resolveProfile({
      workspace,
      profileId: workspace.defaultIcpProfileId,
      source: "workspaceDefault",
      explicit: false,
      warnings,
    });
    if (defaultContext) {
      await emitResolverAlerts(workspace, warnings);
      return defaultContext;
    }
  }

  if ((workspace._count?.icpProfiles ?? 0) > 0) {
    addWarning(warnings, {
      code: "WARN_LEGACY_FALLBACK_DESPITE_PROFILES",
      workspaceId: workspace.id,
      message: `Workspace '${workspace.slug}' fell back to legacy ICP despite having profile records.`,
    });
  }

  const legacy = legacySnapshot(workspace);
  const context: IcpContext = {
    source: "legacy",
    profileId: null,
    versionId: null,
    snapshot: legacy,
    warnings,
  };
  await emitResolverAlerts(workspace, warnings);
  return context;
}

export async function resolveIcpContextForWorkspaceSlug(args: {
  workspaceSlug: string;
  campaignId?: string;
  icpProfileId?: string;
}): Promise<IcpContext & { workspaceId: string }> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: args.workspaceSlug },
    select: { id: true },
  });
  const context = await resolveIcpContext({
    workspaceId: workspace.id,
    campaignId: args.campaignId,
    icpProfileId: args.icpProfileId,
  });
  return { ...context, workspaceId: workspace.id };
}
