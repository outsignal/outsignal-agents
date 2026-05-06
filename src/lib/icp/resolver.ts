import { prisma } from "@/lib/db";
import { expandCountryTerms } from "@/lib/discovery/country-codes";
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
  | "WARN_PROFILE_PARENT_INACTIVE"
  | "WARN_PROFILE_PARENT_NO_VERSION"
  | "WARN_PROFILE_PARENT_NOT_FOUND"
  | "WARN_PROFILE_PARENT_WRONG_WORKSPACE"
  | "WARN_PROFILE_HIERARCHY_CYCLE"
  | "WARN_PROFILE_HIERARCHY_DEPTH_EXCEEDED"
  | "WARN_PROFILE_HIERARCHY_SCOPE_CONFLICT"
  | "WARN_LEGACY_FALLBACK_DESPITE_PROFILES";

export type IcpResolverErrorCode =
  | "EXPLICIT_PROFILE_NOT_FOUND"
  | "EXPLICIT_PROFILE_WRONG_WORKSPACE"
  | "EXPLICIT_PROFILE_INACTIVE"
  | "EXPLICIT_PROFILE_NO_VERSION"
  | "EXPLICIT_PROFILE_PARENT_INACTIVE"
  | "EXPLICIT_PROFILE_PARENT_NO_VERSION"
  | "EXPLICIT_PROFILE_PARENT_NOT_FOUND"
  | "EXPLICIT_PROFILE_PARENT_WRONG_WORKSPACE"
  | "EXPLICIT_PROFILE_HIERARCHY_CYCLE"
  | "EXPLICIT_PROFILE_HIERARCHY_DEPTH_EXCEEDED"
  | "EXPLICIT_PROFILE_HIERARCHY_SCOPE_CONFLICT"
  | "CAMPAIGN_NOT_FOUND"
  | "CAMPAIGN_WRONG_WORKSPACE";

export type IcpResolverWarning = {
  code: IcpResolverWarningCode;
  message: string;
  profileId?: string;
  workspaceId: string;
};

export type IcpProfileLineageEntry = {
  profileId: string;
  profileName: string;
  profileSlug: string;
  versionId: string;
  version: number;
  role: "parent" | "leaf";
};

export type IcpProfileSnapshot = {
  profileId: string;
  profileName: string;
  profileSlug: string;
  versionId: string;
  version: number;
  lineage?: IcpProfileLineageEntry[];
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
  "WARN_PROFILE_PARENT_INACTIVE",
  "WARN_PROFILE_PARENT_NO_VERSION",
  "WARN_PROFILE_PARENT_NOT_FOUND",
  "WARN_PROFILE_PARENT_WRONG_WORKSPACE",
  "WARN_PROFILE_HIERARCHY_CYCLE",
  "WARN_PROFILE_HIERARCHY_DEPTH_EXCEEDED",
  "WARN_PROFILE_HIERARCHY_SCOPE_CONFLICT",
]);

const MAX_PROFILE_HIERARCHY_DEPTH = 3;

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : null))
    .filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : null;
}

function normaliseToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function unionStringArrays(
  ...arrays: Array<string[] | null | undefined>
): string[] | null {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const array of arrays) {
    for (const item of array ?? []) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = normaliseToken(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(trimmed);
    }
  }

  return merged.length > 0 ? merged : null;
}

function valuesOverlap(
  left: string,
  right: string,
  field: "locations" | "industries",
): boolean {
  if (field === "locations") {
    const leftTerms = expandCountryTerms(left);
    const rightTerms = expandCountryTerms(right);
    for (const term of leftTerms) {
      if (rightTerms.has(term)) return true;
    }
    return false;
  }

  return normaliseToken(left) === normaliseToken(right);
}

function intersectStringArrays(
  field: "locations" | "industries",
  parentValues: string[] | null,
  childValues: string[] | null,
): string[] | null {
  if (!parentValues || parentValues.length === 0) return childValues;
  if (!childValues || childValues.length === 0) return parentValues;

  const intersection = childValues.filter((child) =>
    parentValues.some((parent) => valuesOverlap(parent, child, field)),
  );
  const merged = unionStringArrays(intersection);
  if (!merged) {
    throw new Error(
      `ICP hierarchy ${field} conflict: child values [${childValues.join(
        ", ",
      )}] do not intersect parent values [${parentValues.join(", ")}].`,
    );
  }
  return merged;
}

type NumericRange = {
  min: number;
  max: number;
};

function parseRangeNumber(value: string): number {
  return Number.parseInt(value.replace(/,/g, ""), 10);
}

function parseCompanySizeRange(value: string): NumericRange | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const plusMatch = trimmed.match(/^(\d[\d,]*)\s*\+$/);
  if (plusMatch) {
    return {
      min: parseRangeNumber(plusMatch[1]),
      max: Number.POSITIVE_INFINITY,
    };
  }

  const rangeMatch = trimmed.match(/(\d[\d,]*)\s*(?:-|to|–|—)\s*(\d[\d,]*)/);
  if (rangeMatch) {
    const min = parseRangeNumber(rangeMatch[1]);
    const max = parseRangeNumber(rangeMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      return { min, max };
    }
    return null;
  }

  const singleMatch = trimmed.match(/^(\d[\d,]*)$/);
  if (singleMatch) {
    const size = parseRangeNumber(singleMatch[1]);
    if (Number.isFinite(size)) return { min: size, max: size };
  }

  return null;
}

function formatCompanySizeRange(range: NumericRange): string {
  if (range.max === Number.POSITIVE_INFINITY) return `${range.min}+`;
  if (range.min === range.max) return `${range.min}`;
  return `${range.min}-${range.max}`;
}

function intersectCompanySizeArrays(
  parentValues: string[] | null,
  childValues: string[] | null,
): string[] | null {
  if (!parentValues || parentValues.length === 0) return childValues;
  if (!childValues || childValues.length === 0) return parentValues;

  const ranges: string[] = [];
  for (const parentValue of parentValues) {
    const parentRange = parseCompanySizeRange(parentValue);
    if (!parentRange) continue;

    for (const childValue of childValues) {
      const childRange = parseCompanySizeRange(childValue);
      if (!childRange) continue;

      const min = Math.max(parentRange.min, childRange.min);
      const max = Math.min(parentRange.max, childRange.max);
      if (min <= max) ranges.push(formatCompanySizeRange({ min, max }));
    }
  }

  const rangeIntersection = unionStringArrays(ranges);
  if (rangeIntersection) return rangeIntersection;

  const exactIntersection = childValues.filter((child) =>
    parentValues.some((parent) => normaliseToken(parent) === normaliseToken(child)),
  );
  const merged = unionStringArrays(exactIntersection);
  if (!merged) {
    throw new Error(
      `ICP hierarchy companySizes conflict: child values [${childValues.join(
        ", ",
      )}] do not intersect parent values [${parentValues.join(", ")}].`,
    );
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeScoringRubricArrays(
  existing: unknown,
  next: unknown,
): string[] | unknown {
  if (!Array.isArray(existing) && !Array.isArray(next)) return next;
  const merged = unionStringArrays(
    Array.isArray(existing)
      ? existing.filter((item): item is string => typeof item === "string")
      : null,
    Array.isArray(next)
      ? next.filter((item): item is string => typeof item === "string")
      : null,
  );
  return merged ?? next;
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

function currentVersionForProfile(profile: ProfileCandidate) {
  const version = profile.versions.find((v) => v.version === profile.currentVersion);
  return version ?? null;
}

function buildMergedDescription(chain: ProfileCandidate[]): string {
  const descriptions = chain.map((profile, index) => {
    const version = currentVersionForProfile(profile);
    const description = version?.description.trim() ?? "";
    if (chain.length === 1) return description;
    if (index === 0) return `UNIVERSAL CRITERIA:\n${description}`;
    if (index === chain.length - 1) return `VERTICAL CRITERIA:\n${description}`;
    return `SUB-VERTICAL CRITERIA:\n${description}`;
  });

  return descriptions.filter(Boolean).join("\n\n");
}

function mergeScoringRubrics(chain: ProfileCandidate[]): unknown {
  const merged: Record<string, unknown> = {};
  const mergedFrom: IcpProfileLineageEntry[] = [];

  for (const profile of chain) {
    const version = currentVersionForProfile(profile);
    if (!version || !isRecord(version.scoringRubric)) continue;

    mergedFrom.push({
      profileId: profile.id,
      profileName: profile.name,
      profileSlug: profile.slug,
      versionId: version.id,
      version: version.version,
      role: profile === chain[chain.length - 1] ? "leaf" : "parent",
    });

    for (const [key, value] of Object.entries(version.scoringRubric)) {
      if (
        key === "hardExclusions" ||
        key === "hardRequirements" ||
        key === "preferredSignals" ||
        key === "negativeSignals"
      ) {
        merged[key] = mergeScoringRubricArrays(merged[key], value);
        continue;
      }

      merged[key] = value;
    }
  }

  if (Object.keys(merged).length === 0) return null;
  return { ...merged, mergedFrom };
}

function snapshotFromProfileChain(chain: ProfileCandidate[]): IcpProfileSnapshot | null {
  const leaf = chain[chain.length - 1];
  const leafVersion = currentVersionForProfile(leaf);
  if (!leafVersion) return null;

  let targetTitles: string[] | null = null;
  let locations: string[] | null = null;
  let industries: string[] | null = null;
  let companySizes: string[] | null = null;

  for (const profile of chain) {
    const version = currentVersionForProfile(profile);
    if (!version) return null;
    targetTitles = unionStringArrays(targetTitles, asStringArray(version.targetTitles));
    locations = intersectStringArrays(
      "locations",
      locations,
      asStringArray(version.locations),
    );
    industries = intersectStringArrays(
      "industries",
      industries,
      asStringArray(version.industries),
    );
    companySizes = intersectCompanySizeArrays(
      companySizes,
      asStringArray(version.companySizes),
    );
  }

  const lineage: IcpProfileLineageEntry[] = chain.map((profile) => {
    const version = currentVersionForProfile(profile);
    return {
      profileId: profile.id,
      profileName: profile.name,
      profileSlug: profile.slug,
      versionId: version?.id ?? "",
      version: version?.version ?? 0,
      role: profile === leaf ? "leaf" : "parent",
    };
  });

  return {
    profileId: leaf.id,
    profileName: leaf.name,
    profileSlug: leaf.slug,
    versionId: leafVersion.id,
    version: leafVersion.version,
    lineage,
    description: buildMergedDescription(chain),
    targetTitles,
    locations,
    industries,
    companySizes,
    scoringRubric: mergeScoringRubrics(chain),
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

type HierarchyProblem = {
  warningCode: IcpResolverWarningCode;
  explicitCode: IcpResolverErrorCode;
  profileId?: string;
  message: string;
};

function handleHierarchyProblem(
  args: {
    workspace: WorkspaceForIcp;
    explicit: boolean;
    warnings: IcpResolverWarning[];
    problem: HierarchyProblem;
  },
): null {
  if (args.explicit) {
    throw new IcpResolverError(args.problem.explicitCode, args.problem.message);
  }

  addWarning(args.warnings, {
    code: args.problem.warningCode,
    workspaceId: args.workspace.id,
    profileId: args.problem.profileId,
    message: args.problem.message,
  });
  return null;
}

async function buildProfileChain(
  args: {
    workspace: WorkspaceForIcp;
    leaf: ProfileCandidate;
    explicit: boolean;
    warnings: IcpResolverWarning[];
  },
): Promise<ProfileCandidate[] | null> {
  const leafId = args.leaf.id;
  const chainFromLeaf: ProfileCandidate[] = [];
  const seen = new Set<string>();
  let current: ProfileCandidate | null = args.leaf;

  while (current) {
    if (seen.has(current.id)) {
      return handleHierarchyProblem({
        workspace: args.workspace,
        explicit: args.explicit,
        warnings: args.warnings,
        problem: {
          warningCode: "WARN_PROFILE_HIERARCHY_CYCLE",
          explicitCode: "EXPLICIT_PROFILE_HIERARCHY_CYCLE",
          profileId: current.id,
          message: `ICP profile hierarchy for '${leafId}' contains a cycle at '${current.id}'.`,
        },
      });
    }

    seen.add(current.id);

    if (current.workspaceId !== args.workspace.id) {
      return handleHierarchyProblem({
        workspace: args.workspace,
        explicit: args.explicit,
        warnings: args.warnings,
        problem: {
          warningCode: "WARN_PROFILE_PARENT_WRONG_WORKSPACE",
          explicitCode: "EXPLICIT_PROFILE_PARENT_WRONG_WORKSPACE",
          profileId: current.id,
          message: `ICP profile '${current.id}' in hierarchy for '${leafId}' belongs to workspace '${current.workspace.slug}', not '${args.workspace.slug}'.`,
        },
      });
    }

    if (current.id !== leafId && !current.active) {
      return handleHierarchyProblem({
        workspace: args.workspace,
        explicit: args.explicit,
        warnings: args.warnings,
        problem: {
          warningCode: "WARN_PROFILE_PARENT_INACTIVE",
          explicitCode: "EXPLICIT_PROFILE_PARENT_INACTIVE",
          profileId: current.id,
          message: `Parent ICP profile '${current.id}' for '${leafId}' is inactive; falling back.`,
        },
      });
    }

    if (!currentVersionForProfile(current)) {
      const isLeaf = current.id === leafId;
      return handleHierarchyProblem({
        workspace: args.workspace,
        explicit: args.explicit,
        warnings: args.warnings,
        problem: {
          warningCode: isLeaf ? "WARN_PROFILE_NO_VERSION" : "WARN_PROFILE_PARENT_NO_VERSION",
          explicitCode: isLeaf
            ? "EXPLICIT_PROFILE_NO_VERSION"
            : "EXPLICIT_PROFILE_PARENT_NO_VERSION",
          profileId: current.id,
          message: isLeaf
            ? `ICP profile '${current.id}' has currentVersion=${current.currentVersion}, but no matching version row; falling back.`
            : `Parent ICP profile '${current.id}' for '${leafId}' has currentVersion=${current.currentVersion}, but no matching version row; falling back.`,
        },
      });
    }

    chainFromLeaf.push(current);

    if (chainFromLeaf.length > MAX_PROFILE_HIERARCHY_DEPTH) {
      return handleHierarchyProblem({
        workspace: args.workspace,
        explicit: args.explicit,
        warnings: args.warnings,
        problem: {
          warningCode: "WARN_PROFILE_HIERARCHY_DEPTH_EXCEEDED",
          explicitCode: "EXPLICIT_PROFILE_HIERARCHY_DEPTH_EXCEEDED",
          profileId: current.id,
          message: `ICP profile hierarchy for '${leafId}' exceeds the maximum depth of ${MAX_PROFILE_HIERARCHY_DEPTH}.`,
        },
      });
    }

    if (!current.parentProfileId) break;
    const parent = await fetchProfileCandidate(current.parentProfileId);
    if (!parent) {
      return handleHierarchyProblem({
        workspace: args.workspace,
        explicit: args.explicit,
        warnings: args.warnings,
        problem: {
          warningCode: "WARN_PROFILE_PARENT_NOT_FOUND",
          explicitCode: "EXPLICIT_PROFILE_PARENT_NOT_FOUND",
          profileId: current.parentProfileId,
          message: `Parent ICP profile '${current.parentProfileId}' for '${leafId}' does not exist; falling back.`,
        },
      });
    }

    current = parent;
  }

  return chainFromLeaf.reverse();
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

  const chain = await buildProfileChain({
    workspace: args.workspace,
    leaf: profile,
    explicit: args.explicit,
    warnings: args.warnings,
  });
  if (!chain) return null;

  let snapshot: IcpProfileSnapshot | null = null;
  try {
    snapshot = snapshotFromProfileChain(chain);
  } catch (error) {
    return handleHierarchyProblem({
      workspace: args.workspace,
      explicit: args.explicit,
      warnings: args.warnings,
      problem: {
        warningCode: "WARN_PROFILE_HIERARCHY_SCOPE_CONFLICT",
        explicitCode: "EXPLICIT_PROFILE_HIERARCHY_SCOPE_CONFLICT",
        profileId: profile.id,
        message:
          error instanceof Error
            ? error.message
            : `ICP profile hierarchy for '${profile.id}' has incompatible scope.`,
      },
    });
  }
  if (!snapshot) return null;

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
