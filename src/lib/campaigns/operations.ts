/**
 * Shared operations layer for the Campaign Agent and future MCP tools.
 *
 * ALL Prisma queries and business logic for campaigns live here.
 * Agent tools, API routes, and MCP tools are thin wrappers that call these functions.
 * Never put DB queries or business logic inside agent tool closures.
 *
 * Exports: createCampaign, getCampaign, listCampaigns, updateCampaign,
 *          updateCampaignStatus, deleteCampaign, publishForReview, saveCampaignSequences,
 *          approveCampaignLeads, rejectCampaignLeads, approveCampaignContent,
 *          rejectCampaignContent, getCampaignLeadSample
 */

import { prisma } from "@/lib/db";
import { SYSTEM_ADMIN_EMAIL } from "@/lib/audit";
import { createApprovedContentArtifact } from "@/lib/campaigns/content-integrity";
import { validateListForChannel, runDataQualityPreCheck, type DataQualityReport } from "@/lib/campaigns/list-validation";
import { filterPeopleForChannels } from "@/lib/channels/validation";
import { auditTargetListForChannel, type ChannelValidationResult } from "@/lib/validation/channel-gate";
import { detectOverlaps, type OverlapResult } from "@/lib/campaigns/overlap-detection";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface CreateCampaignParams {
  workspaceSlug: string;
  name: string;
  description?: string;
  channels?: string[]; // ["email"], ["linkedin"], or ["email", "linkedin"]
  targetListId?: string;
  // Signal campaign fields
  type?: "static" | "signal";
  icpCriteria?: string | null; // JSON string (pass JSON.stringify(icpCriteriaObject))
  signalTypes?: string | null; // JSON string (pass JSON.stringify(signalTypesArray))
  dailyLeadCap?: number;
  icpScoreThreshold?: number;
}

export interface UpdateCampaignParams {
  name?: string;
  description?: string;
  channels?: string[];
  targetListId?: string;
}

export interface ApprovalAuditContext {
  adminEmail: string;
  actorRole?: string | null;
  workspaceSlug: string;
  campaignName: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  workspaceSlug: string;
  type: string;
  status: string;
  channels: string[];
  targetListName: string | null;
  targetListLeadCount: number;
  emailBisonCampaignId: number | null;
  leadsApproved: boolean;
  contentApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignDetail extends CampaignSummary {
  description: string | null;
  emailSequence: unknown[] | null; // parsed JSON
  linkedinSequence: unknown[] | null; // parsed JSON
  copyStrategy: string | null; // "creative-ideas" | "pvp" | "one-liner" | "custom" | null
  targetListId: string | null;
  targetListPeopleCount: number;
  leadsFeedback: string | null;
  leadsApprovedAt: Date | null;
  contentFeedback: string | null;
  contentApprovedAt: Date | null;
  approvedContentHash: string | null;
  approvedContentSnapshot: unknown | null;
  emailBisonCampaignId: number | null;
  publishedAt: Date | null;
  deployedAt: Date | null;
  // Signal campaign fields
  icpCriteria: unknown | null; // parsed JSON
  signalTypes: string[] | null; // parsed JSON array
  dailyLeadCap: number;
  icpScoreThreshold: number;
  signalEmailBisonCampaignId: number | null;
  lastSignalProcessedAt: Date | null;
}

// ---------------------------------------------------------------------------
// State machine — valid status transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["internal_review"],
  internal_review: ["pending_approval", "draft"],
  pending_approval: ["approved", "internal_review"],
  approved: ["deployed"],
  deployed: ["active"],
  active: ["paused", "completed"],
  paused: ["active", "completed", "pending_approval"],
};

// Signal campaigns use a simplified state machine (per CONTEXT.md decision):
//   draft -> active (admin activates after review)
//   active -> paused | archived
//   paused -> active | archived
// Static campaigns keep existing machine unchanged.
const SIGNAL_CAMPAIGN_TRANSITIONS: Record<string, string[]> = {
  draft: ["active"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string column into an array (or return null if not set).
 */
function parseJsonArray(value: string | null): unknown[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Canonicalize a value by recursively sorting object keys. Ensures
 * JSON.stringify produces a stable, order-independent representation so
 * semantically-equal sequences with reordered keys (e.g. caller-side Zod
 * reshuffles) compare as equal.
 */
function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonicalize((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/**
 * Compare an already-parsed prior sequence array against the incoming new
 * sequence. Used by saveCampaignSequences to avoid spurious contentApproved
 * resets on idempotent saves (UI retries, client-side dedup races) and on
 * callers that reorder object keys.
 *
 * Returns true when the two logically represent the same sequence. A null
 * prior is equal to an empty incoming array (both mean "no content").
 * Callers pass the PARSED prior (via parseJsonArray) so we avoid a redundant
 * JSON.parse and the asymmetry where parseJsonArray returns null on malformed
 * JSON but a raw-string equality check would see mismatched text.
 */
function sequencesEqualParsed(
  prior: unknown[] | null,
  next: unknown[],
): boolean {
  if (!prior) return next.length === 0;
  return (
    JSON.stringify(canonicalize(prior)) === JSON.stringify(canonicalize(next))
  );
}

/**
 * Guard against legacy zero-based email positions leaking back into storage.
 * Reply attribution and downstream analytics assume email sequence positions
 * are canonical 1..N, even though a small older Lime subset was historically
 * stored as 0..N-1. Rejecting non-canonical saves here prevents new drift.
 */
function assertCanonicalEmailSequencePositions(emailSequence: unknown[]): void {
  if (emailSequence.length === 0) return;

  const positions = emailSequence
    .map((step) =>
      step && typeof step === "object"
        ? (step as Record<string, unknown>).position
        : undefined,
    )
    .slice()
    .sort((a, b) => Number(a) - Number(b));

  const expected = Array.from({ length: emailSequence.length }, (_, idx) => idx + 1);
  const valid =
    positions.length === expected.length &&
    positions.every(
      (position, idx) =>
        Number.isInteger(position) &&
        typeof position === "number" &&
        position === expected[idx],
    );

  if (!valid) {
    throw new Error(
      `emailSequence positions must be canonical 1-indexed steps ${JSON.stringify(expected)}; received ${JSON.stringify(positions)}`,
    );
  }
}

/**
 * Guard against delayDays semantic drift on email sequences.
 *
 * Canonical source-of-truth encoding is absolute day-from-start:
 *   step 1 = day 0
 *   later steps = strictly increasing absolute offsets
 *
 * Gap-encoded sequences such as [0,14,14] are forbidden in storage even
 * though the adapter can translate absolute values to EmailBison's gap wire
 * format. Keeping a single canonical source encoding prevents future mixed
 * semantics from creeping back into Campaign.emailSequence.
 */
function assertCanonicalEmailSequenceDelayEncoding(
  emailSequence: unknown[],
): void {
  if (emailSequence.length === 0) return;

  const sortedSteps = emailSequence
    .map((step) =>
      step && typeof step === "object" ? (step as Record<string, unknown>) : null,
    )
    .filter((step): step is Record<string, unknown> => step !== null)
    .sort((a, b) => Number(a.position) - Number(b.position));

  const delayDays = sortedSteps.map((step) => step.delayDays);
  const hasAnyDelayDays = delayDays.some((delay) => delay !== undefined);
  if (!hasAnyDelayDays) {
    return;
  }

  const numericDelayDays = delayDays.map((delay) =>
    typeof delay === "number" && Number.isFinite(delay) ? delay : NaN,
  );

  if (numericDelayDays.some((delay) => Number.isNaN(delay))) {
    throw new Error(
      `emailSequence delayDays must be numeric absolute-day offsets; received ${JSON.stringify(delayDays)}`,
    );
  }

  if (numericDelayDays[0] !== 0) {
    throw new Error(
      `emailSequence delayDays must use canonical absolute-from-start semantics beginning at day 0; received ${JSON.stringify(numericDelayDays)}`,
    );
  }

  for (let idx = 1; idx < numericDelayDays.length; idx += 1) {
    if (numericDelayDays[idx] <= numericDelayDays[idx - 1]) {
      throw new Error(
        `emailSequence delayDays must be strictly increasing absolute-day offsets; received ${JSON.stringify(numericDelayDays)}`,
      );
    }
  }
}

/**
 * Shape a raw Prisma Campaign record into CampaignDetail.
 */
function formatCampaignDetail(
  raw: {
    id: string;
    name: string;
    workspaceSlug: string;
    type: string;
    status: string;
    channels: string;
    description: string | null;
    emailSequence: string | null;
    linkedinSequence: string | null;
    copyStrategy: string | null;
    targetListId: string | null;
    leadsApproved: boolean;
    leadsFeedback: string | null;
    leadsApprovedAt: Date | null;
    contentApproved: boolean;
    contentFeedback: string | null;
    contentApprovedAt: Date | null;
    approvedContentHash?: string | null;
    approvedContentSnapshot?: unknown | null;
    emailBisonCampaignId: number | null;
    publishedAt: Date | null;
    deployedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    // Signal campaign fields
    icpCriteria: string | null;
    signalTypes: string | null;
    dailyLeadCap: number;
    icpScoreThreshold: number;
    signalEmailBisonCampaignId: number | null;
    lastSignalProcessedAt: Date | null;
    targetList: {
      name: string;
      _count: { people: number };
    } | null;
  },
): CampaignDetail {
  return {
    id: raw.id,
    name: raw.name,
    workspaceSlug: raw.workspaceSlug,
    type: raw.type,
    status: raw.status,
    channels: parseJsonArray(raw.channels) as string[] ?? ["email"],
    targetListName: raw.targetList?.name ?? null,
    targetListLeadCount: raw.targetList?._count.people ?? 0,
    leadsApproved: raw.leadsApproved,
    contentApproved: raw.contentApproved,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    description: raw.description,
    emailSequence: parseJsonArray(raw.emailSequence),
    linkedinSequence: parseJsonArray(raw.linkedinSequence),
    copyStrategy: raw.copyStrategy ?? null,
    targetListId: raw.targetListId,
    targetListPeopleCount: raw.targetList?._count.people ?? 0,
    leadsFeedback: raw.leadsFeedback,
    leadsApprovedAt: raw.leadsApprovedAt,
    contentFeedback: raw.contentFeedback,
    contentApprovedAt: raw.contentApprovedAt,
    approvedContentHash: raw.approvedContentHash ?? null,
    approvedContentSnapshot: raw.approvedContentSnapshot ?? null,
    emailBisonCampaignId: raw.emailBisonCampaignId,
    publishedAt: raw.publishedAt,
    deployedAt: raw.deployedAt,
    // Signal campaign fields
    icpCriteria: raw.icpCriteria ? (() => { try { return JSON.parse(raw.icpCriteria!); } catch { return null; } })() : null,
    signalTypes: parseJsonArray(raw.signalTypes) as string[] | null,
    dailyLeadCap: raw.dailyLeadCap,
    icpScoreThreshold: raw.icpScoreThreshold,
    signalEmailBisonCampaignId: raw.signalEmailBisonCampaignId,
    lastSignalProcessedAt: raw.lastSignalProcessedAt,
  };
}

/**
 * Prisma include/select for targetList with _count of people.
 */
const targetListInclude = {
  targetList: {
    select: {
      name: true,
      _count: {
        select: { people: true },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// 1. createCampaign — create a new campaign
// ---------------------------------------------------------------------------

/**
 * Create a new campaign for a workspace.
 *
 * Validates that the workspace exists before creating. Defaults channels to
 * ["email"] if not provided.
 *
 * @param params - { workspaceSlug, name, description?, channels?, targetListId? }
 * @returns The created CampaignDetail
 * @throws If workspace does not exist
 */
export async function createCampaign(
  params: CreateCampaignParams,
): Promise<CampaignDetail> {
  const {
    workspaceSlug,
    name,
    description,
    channels,
    targetListId,
    type,
    icpCriteria,
    signalTypes,
    dailyLeadCap,
    icpScoreThreshold,
  } = params;

  // Validate workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { slug: true },
  });

  if (!workspace) {
    throw new Error(`Workspace not found: '${workspaceSlug}'`);
  }

  const resolvedChannels = channels && channels.length > 0 ? channels : ["email"];
  const resolvedType = type ?? "static";

  const campaign = await prisma.campaign.create({
    data: {
      workspaceSlug,
      name,
      description,
      channels: JSON.stringify(resolvedChannels),
      targetListId: targetListId ?? null,
      type: resolvedType,
      ...(resolvedType === "signal" && {
        icpCriteria: icpCriteria ?? null,
        signalTypes: signalTypes ?? null,
        ...(dailyLeadCap !== undefined && { dailyLeadCap }),
        ...(icpScoreThreshold !== undefined && { icpScoreThreshold }),
      }),
    },
    include: targetListInclude,
  });

  return formatCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// 2. getCampaign — get a single campaign by id
// ---------------------------------------------------------------------------

/**
 * Get a single campaign by ID with targetList info and people count.
 *
 * @param id - Campaign ID
 * @returns CampaignDetail or null if not found
 */
export async function getCampaign(id: string): Promise<CampaignDetail | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: targetListInclude,
  });

  if (!campaign) return null;

  return formatCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// 3. listCampaigns — list all campaigns for a workspace
// ---------------------------------------------------------------------------

/**
 * List all campaigns for a workspace, ordered by updatedAt descending.
 *
 * @param workspaceSlug - Workspace slug to filter by
 * @returns Array of CampaignSummary objects
 */
export async function listCampaigns(
  workspaceSlug: string,
): Promise<CampaignSummary[]> {
  const campaigns = await prisma.campaign.findMany({
    where: { workspaceSlug },
    include: {
      targetList: {
        select: {
          name: true,
          _count: {
            select: { people: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    workspaceSlug: c.workspaceSlug,
    type: c.type,
    status: c.status,
    channels: parseJsonArray(c.channels) as string[] ?? ["email"],
    targetListName: c.targetList?.name ?? null,
    targetListLeadCount: c.targetList?._count.people ?? 0,
    emailBisonCampaignId: c.emailBisonCampaignId,
    leadsApproved: c.leadsApproved,
    contentApproved: c.contentApproved,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// 4. updateCampaign — update campaign metadata
// ---------------------------------------------------------------------------

/**
 * Update campaign metadata fields. Only provided fields are updated.
 *
 * @param id - Campaign ID
 * @param params - Fields to update (name, description, channels, targetListId)
 * @returns Updated CampaignDetail
 */
export async function updateCampaign(
  id: string,
  params: UpdateCampaignParams,
): Promise<CampaignDetail> {
  const { name, description, channels, targetListId } = params;

  // Build update data with only provided fields
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (channels !== undefined) data.channels = JSON.stringify(channels);
  if (targetListId !== undefined) data.targetListId = targetListId;

  const campaign = await prisma.campaign.update({
    where: { id },
    data,
    include: targetListInclude,
  });

  return formatCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// 5. updateCampaignStatus — transition campaign status via state machine
// ---------------------------------------------------------------------------

/**
 * Transition a campaign to a new status, enforcing the state machine.
 *
 * Valid transitions:
 *   draft -> internal_review
 *   internal_review -> pending_approval | draft
 *   pending_approval -> approved | internal_review
 *   approved -> deployed
 *   deployed -> active
 *   active -> paused | completed
 *   paused -> active | completed | pending_approval
 *   any -> completed (always allowed)
 *
 * @param id - Campaign ID
 * @param newStatus - Target status
 * @returns Updated CampaignDetail
 * @throws If the transition is invalid
 */
export async function updateCampaignStatus(
  id: string,
  newStatus: string,
): Promise<CampaignDetail> {
  const current = await prisma.campaign.findUnique({
    where: { id },
    select: { status: true, type: true },
  });

  if (!current) {
    throw new Error(`Campaign not found: '${id}'`);
  }

  const currentStatus = current.status;
  const isSignal = (current as { type?: string }).type === "signal";
  const transitions = isSignal ? SIGNAL_CAMPAIGN_TRANSITIONS : VALID_TRANSITIONS;

  // Allow any -> completed
  if (newStatus !== "completed") {
    const allowedTransitions = transitions[currentStatus] ?? [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: '${currentStatus}' -> '${newStatus}'. ` +
          `Allowed transitions from '${currentStatus}': ${
            allowedTransitions.length > 0
              ? allowedTransitions.join(", ")
              : "none"
          }`,
      );
    }
  }

  const transitioned = await prisma.campaign.updateMany({
    where: { id, status: currentStatus },
    data: { status: newStatus },
  });

  if (transitioned.count === 0) {
    const latest = await prisma.campaign.findUnique({
      where: { id },
      select: { status: true },
    });
    throw new Error(
      `Campaign ${id} was modified concurrently while changing status from '${currentStatus}' to '${newStatus}'. Latest status is '${latest?.status ?? "unknown"}'. Reload and retry.`,
    );
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: targetListInclude,
  });

  if (!campaign) {
    throw new Error(`Campaign not found after status transition: '${id}'`);
  }

  return formatCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// 6. deleteCampaign — delete a campaign (draft/internal_review only)
// ---------------------------------------------------------------------------

/**
 * Delete a campaign by ID. Only campaigns in "draft" or "internal_review"
 * status can be deleted.
 *
 * @param id - Campaign ID
 * @throws If campaign is not in draft or internal_review status
 */
export async function deleteCampaign(id: string): Promise<void> {
  const current = await prisma.campaign.findUnique({
    where: { id },
    select: { status: true, name: true, workspaceSlug: true },
  });

  if (!current) {
    throw new Error(`Campaign not found: '${id}'`);
  }

  const deletableStatuses = ["draft", "internal_review"];
  if (!deletableStatuses.includes(current.status)) {
    throw new Error(
      `Cannot delete campaign in status '${current.status}'. ` +
        `Only campaigns in 'draft' or 'internal_review' can be deleted.`,
    );
  }

  // Cascade delete sequence rules before deleting the campaign
  await prisma.campaignSequenceRule.deleteMany({
    where: { workspaceSlug: current.workspaceSlug, campaignName: current.name },
  });

  await prisma.campaign.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// 7. publishForReview — push campaign to pending_approval
// ---------------------------------------------------------------------------

export interface PublishForReviewResult {
  campaign: CampaignDetail;
  warnings?: {
    dataQuality?: DataQualityReport;
    overlaps?: OverlapResult[];
    channelGate?: ChannelValidationResult;
  };
}

/**
 * Publish a campaign for client review by transitioning to "pending_approval".
 *
 * Validates:
 *   - Current status is "internal_review"
 *   - Campaign has at least one sequence (emailSequence or linkedinSequence)
 *   - Campaign has a targetListId (leads must be linked)
 *   - Channel-specific list validation (hard-blocks if requirements not met)
 *
 * Runs non-blocking checks:
 *   - Data quality pre-check (warnings only)
 *   - Overlap detection (warnings only — admin decides)
 *
 * Sets publishedAt to the current timestamp.
 *
 * @param id - Campaign ID
 * @returns { campaign: CampaignDetail, warnings?: { dataQuality?, overlaps? } }
 * @throws If validation fails (status, content, list, or channel requirements)
 */
export async function publishForReview(id: string): Promise<PublishForReviewResult> {
  const current = await prisma.campaign.findUnique({
    where: { id },
    select: {
      status: true,
      channels: true,
      workspaceSlug: true,
      emailSequence: true,
      linkedinSequence: true,
      targetListId: true,
    },
  });

  if (!current) {
    throw new Error(`Campaign not found: '${id}'`);
  }

  // Must be in internal_review to publish
  if (current.status !== "internal_review") {
    throw new Error(
      `Cannot publish campaign in status '${current.status}'. ` +
        `Campaign must be in 'internal_review' status to publish for review.`,
    );
  }

  // Must have at least one sequence
  const hasEmail = Boolean(
    current.emailSequence && parseJsonArray(current.emailSequence)?.length,
  );
  const hasLinkedIn = Boolean(
    current.linkedinSequence && parseJsonArray(current.linkedinSequence)?.length,
  );

  if (!hasEmail && !hasLinkedIn) {
    throw new Error(
      `Cannot publish campaign without content. ` +
        `At least one sequence (emailSequence or linkedinSequence) must be set before publishing.`,
    );
  }

  // Must have a target list
  if (!current.targetListId) {
    throw new Error(
      `Cannot publish campaign without a target list. ` +
        `Link a TargetList to this campaign before publishing for review.`,
    );
  }

  // --- Channel-aware list validation (Phase 57) ---
  const channels = (parseJsonArray(current.channels) as string[] ?? ["email"]) as ("email" | "linkedin")[];

  // Load target list people for validation
  const targetListPeople = await prisma.targetListPerson.findMany({
    where: { listId: current.targetListId },
    include: {
      person: {
        select: {
          id: true,
          email: true,
          linkedinUrl: true,
          firstName: true,
          lastName: true,
          company: true,
          jobTitle: true,
        },
      },
    },
  });

  const people = targetListPeople.map((tlp) => tlp.person);

  // Hard-block: channel requirements (structural — 0 valid emails / LinkedIn URLs)
  const channelFailures: string[] = [];
  for (const channel of channels) {
    const result = validateListForChannel(channel, people);
    if (!result.valid) {
      channelFailures.push(...result.hardFailures);
    }
  }

  // Hard-block: per-person validation (placeholder emails, missing LinkedIn URLs)
  const { rejected: perPersonRejected } = filterPeopleForChannels(people, channels);
  if (perPersonRejected.length > 0) {
    // Group reasons for a compact error message.
    const reasonCounts = new Map<string, number>();
    for (const { reason } of perPersonRejected) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    const reasonSummary = Array.from(reasonCounts.entries())
      .map(([r, n]) => `${n}× ${r}`)
      .join("; ");
    channelFailures.push(
      `${perPersonRejected.length} of ${people.length} people fail channel requirements — ${reasonSummary}. ` +
        `Remove these people from the list before publishing.`,
    );
  }

  if (channelFailures.length > 0) {
    throw new Error(
      `Cannot publish campaign — list validation failed: ${channelFailures.join("; ")}`,
    );
  }

  // Non-blocking: data quality pre-check
  const dataQuality = runDataQualityPreCheck(channels, people);

  // Non-blocking: overlap detection
  const personIds = people.map((p) => p.id);
  const overlaps = await detectOverlaps({
    workspaceSlug: current.workspaceSlug,
    candidatePersonIds: personIds,
    excludeCampaignId: id,
  });

  // Non-blocking: verification-aware channel gate audit (BL-009)
  // Soft gate — warns about unverified/invalid emails but does not block publishing.
  const channelForGate = channels.includes("email") && channels.includes("linkedin")
    ? "both" as const
    : channels.includes("linkedin")
      ? "linkedin" as const
      : "email" as const;
  const channelGateResult = await auditTargetListForChannel(
    current.targetListId,
    channelForGate,
  );
  if (channelGateResult.rejected.length > 0) {
    console.warn(
      `[publishForReview] campaign=${id} channel-gate audit: ` +
        `${channelGateResult.rejected.length} of ${personIds.length} people ` +
        `fail verification requirements (soft warning, not blocking)`,
    );
  }

  // All checks passed — publish
  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      status: "pending_approval",
      publishedAt: new Date(),
    },
    include: targetListInclude,
  });

  const warnings: PublishForReviewResult["warnings"] = {};
  if (!dataQuality.pass || dataQuality.warnings.length > 0) {
    warnings.dataQuality = dataQuality;
  }
  if (overlaps.length > 0) {
    warnings.overlaps = overlaps;
  }
  if (channelGateResult.rejected.length > 0) {
    warnings.channelGate = channelGateResult;
  }

  const result: PublishForReviewResult = {
    campaign: formatCampaignDetail(campaign),
    ...(Object.keys(warnings).length > 0 ? { warnings } : {}),
  };

  // Notify client that campaign is ready for review (non-blocking)
  try {
    const { notifyCampaignsPendingApproval } = await import("@/lib/notifications");
    const channels = (parseJsonArray(campaign.channels) as string[] ?? ["email"]);
    await notifyCampaignsPendingApproval({
      workspaceSlug: campaign.workspaceSlug,
      campaigns: [
        {
          name: campaign.name,
          channel: channels.join(", "),
          leadCount: campaign.targetList?._count.people ?? 0,
        },
      ],
    });
  } catch (err) {
    console.error("[publishForReview] Failed to send pending approval notification:", err);
  }

  return result;
}

// ---------------------------------------------------------------------------
// 8. saveCampaignSequences — store email and/or LinkedIn sequences
// ---------------------------------------------------------------------------

/**
 * Save campaign sequence content. Only provided sequences are updated —
 * passing undefined for a sequence leaves it unchanged.
 *
 * BL-053 — contentApproved reset:
 * If the caller is persisting a sequence that OVERWRITES an existing sequence
 * on a campaign where `contentApproved === true`, flip contentApproved back
 * to false (and clear contentApprovedAt) so the client re-reviews the new
 * copy. Write an AuditLog row documenting the reset. First-time sequence
 * saves never trigger the reset — the campaign was never approved against
 * any prior copy.
 *
 * NOTE (deferred): leadsApproved reset is intentionally out of scope here —
 * sequence overwrites do not change the lead list, so leadsApproved is
 * unaffected. See BL-053 scope.
 *
 * @param id - Campaign ID
 * @param data - { emailSequence?, linkedinSequence? }
 * @returns Updated CampaignDetail
 */
export async function saveCampaignSequences(
  id: string,
  data: { emailSequence?: unknown[]; linkedinSequence?: unknown[]; copyStrategy?: string },
): Promise<CampaignDetail> {
  const { emailSequence, linkedinSequence } = data;

  if (emailSequence !== undefined) {
    assertCanonicalEmailSequencePositions(emailSequence);
    assertCanonicalEmailSequenceDelayEncoding(emailSequence);
  }

  const updateData: Record<string, unknown> = {};
  if (emailSequence !== undefined) {
    updateData.emailSequence = JSON.stringify(emailSequence);
  }
  if (linkedinSequence !== undefined) {
    updateData.linkedinSequence = JSON.stringify(linkedinSequence);
  }
  if (data.copyStrategy !== undefined) {
    updateData.copyStrategy = data.copyStrategy;
  }

  return prisma.$transaction(async (tx) => {
    // Read current state inside the transaction so we can detect overwrite
    // semantics atomically with the update.
    const current = await tx.campaign.findUnique({
      where: { id },
      select: {
        workspaceSlug: true,
        name: true,
        status: true,
        updatedAt: true,
        contentApproved: true,
        contentApprovedAt: true,
        approvedContentHash: true,
        emailSequence: true,
        linkedinSequence: true,
      },
    });

    if (!current) {
      throw new Error(`Campaign not found: '${id}'`);
    }

    // Is this save OVERWRITING prior content? Three conditions must hold
    // for a channel to count as an overwrite:
    //   1. The channel is being saved in this call (not undefined).
    //   2. The channel had PRIOR CONTENT — first-time saves never count
    //      (campaign was never approved against prior copy for this channel).
    //   3. The new content DIFFERS from the prior content (sequencesEqualParsed
    //      catches UI retries / idempotent clients so they don't spuriously
    //      strip approval; canonicalize() also neutralises object-key reorders).
    // A clear (new=[], prior non-empty) satisfies all three → IS an
    // overwrite. An empty→empty re-clear satisfies (1) + (3-negated) → NOT
    // an overwrite.
    //
    // Finding D: parse the prior sequences once and reuse. sequencesEqualParsed
    // takes the already-parsed array so we never double-parse the same string.
    const emailPrior = parseJsonArray(current.emailSequence);
    const linkedinPrior = parseJsonArray(current.linkedinSequence);
    const emailPriorContent = (emailPrior?.length ?? 0) > 0;
    const linkedinPriorContent = (linkedinPrior?.length ?? 0) > 0;
    const emailIsOverwrite =
      emailSequence !== undefined &&
      emailPriorContent &&
      !sequencesEqualParsed(emailPrior, emailSequence);
    const linkedinIsOverwrite =
      linkedinSequence !== undefined &&
      linkedinPriorContent &&
      !sequencesEqualParsed(linkedinPrior, linkedinSequence);
    const isOverwrite = emailIsOverwrite || linkedinIsOverwrite;

    // Reset only fires when approval was true AND content actually changed.
    // A copyStrategy-only save (no sequences passed) is metadata — it does
    // not touch contentApproved.
    const shouldResetApproval = current.contentApproved && isOverwrite;
    const shouldClearApprovedArtifact =
      isOverwrite &&
      (current.contentApproved ||
        current.contentApprovedAt != null ||
        current.approvedContentHash != null);
    const previousStatus = current.status;

    // Finding A: active/deployed/paused/completed campaigns must not accept
    // silent content overwrites. Force callers to pause and re-approve via
    // the proper flow. Throw BEFORE writing anything so no state changes.
    if (
      shouldResetApproval &&
      ["deployed", "active", "paused", "completed"].includes(previousStatus)
    ) {
      throw new Error(
        `Cannot overwrite sequence on campaign ${id} with status="${previousStatus}". ` +
          `Pause the campaign first, then re-approve the new content.`,
      );
    }

    // Finding F: single source of truth for the new status. Ternary avoids
    // the let→mutate pattern and keeps the update-data block and audit
    // metadata in lockstep.
    const newStatus =
      shouldResetApproval && previousStatus === "approved"
        ? "pending_approval"
        : previousStatus;

    if (shouldClearApprovedArtifact) {
      updateData.approvedContentHash = null;
      updateData.approvedContentSnapshot = null;
      updateData.contentApprovedAt = null;
    }

    if (shouldResetApproval) {
      updateData.contentApproved = false;
      // Mirror the forward-transition pattern in approveCampaignContent /
      // approveCampaignLeads (status flips when dual-approval state changes).
      // If the campaign had reached 'approved' via dual approval, the reset
      // must flip the status back to 'pending_approval' so the client is
      // asked to re-review the new copy. Without this, the campaign is
      // 'approved' but holds unapproved content — the exact 1210 bug.
      if (newStatus !== previousStatus) {
        updateData.status = newStatus;
      }
    }

    let campaign;
    const txCampaign = tx.campaign as typeof tx.campaign & {
      updateMany?: (args: {
        where: { id: string; updatedAt: Date };
        data: Record<string, unknown>;
      }) => Promise<{ count: number }>;
    };

    if (typeof txCampaign.updateMany === "function") {
      const updated = await txCampaign.updateMany({
        where: { id, updatedAt: current.updatedAt },
        data: updateData,
      });

      if (updated.count === 0) {
        throw new Error(
          `Campaign ${id} was modified concurrently while saving sequences. Reload and retry.`,
        );
      }

      campaign = await tx.campaign.findUnique({
        where: { id },
        include: targetListInclude,
      });
      if (!campaign) {
        throw new Error(`Campaign not found after update: '${id}'`);
      }
    } else {
      // Test fallback for focused unit suites that still stub only `update`.
      campaign = await tx.campaign.update({
        where: { id },
        data: updateData,
        include: targetListInclude,
      });
    }

    if (shouldResetApproval) {
      // Direct tx.auditLog.create (not the shared auditLog() helper) because
      // this write MUST participate in the enclosing transaction — helper
      // uses the top-level prisma client and is fire-and-forget.
      //
      // NOTE: Atomicity guarantee depends on real Prisma's $transaction
      // rollback. Unit tests verify error propagation only — true rollback
      // would require an integration test against a real DB.
      await tx.auditLog.create({
        data: {
          action: "campaign.contentApproved.reset",
          entityType: "Campaign",
          entityId: id,
          adminEmail: SYSTEM_ADMIN_EMAIL,
          metadata: {
            workspace: current.workspaceSlug,
            campaignName: current.name,
            reason: "sequence overwritten",
            emailOverwritten: emailIsOverwrite,
            linkedinOverwritten: linkedinIsOverwrite,
            previousContentApproved: true,
            newContentApproved: false,
            previousStatus,
            newStatus,
            // Finding E: explicit boolean so searching audit logs for actual
            // transitions doesn't require comparing two string fields.
            statusChanged: previousStatus !== newStatus,
            resetAt: new Date().toISOString(),
          },
        },
      });
    }

    return formatCampaignDetail(campaign);
  });
}

// ---------------------------------------------------------------------------
// 9. approveCampaignLeads — approve the lead list for a campaign
// ---------------------------------------------------------------------------

/**
 * Approve the lead list for a campaign.
 *
 * Sets leadsApproved: true, clears previous feedback, sets timestamp.
 * If contentApproved is also true and status is 'pending_approval',
 * auto-transitions the campaign to 'approved'.
 *
 * @param id - Campaign ID
 * @returns Updated CampaignDetail
 * @throws If campaign not found
 */
export async function approveCampaignLeads(
  id: string,
  auditContext?: ApprovalAuditContext,
): Promise<CampaignDetail> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.campaign.findUnique({
      where: { id },
      select: { contentApproved: true, status: true },
    });

    if (!current) throw new Error(`Campaign not found: '${id}'`);

    const updateData: Record<string, unknown> = {
      leadsApproved: true,
      leadsApprovedAt: new Date(),
      leadsFeedback: null, // clear previous feedback on approval
    };

    // Dual approval check: if content is ALSO already approved, transition to 'approved'
    if (current.contentApproved && current.status === "pending_approval") {
      updateData.status = "approved";
    }

    const campaign = await tx.campaign.update({
      where: { id },
      data: updateData,
      include: targetListInclude,
    });

    if (auditContext) {
      await tx.auditLog.create({
        data: {
          action: "campaign.approve_leads",
          entityType: "Campaign",
          entityId: id,
          adminEmail: auditContext.adminEmail,
          metadata: {
            actorRole: auditContext.actorRole ?? "client",
            campaignName: auditContext.campaignName,
            previousStatus: current.status,
            newStatus: campaign.status,
            approvedAt:
              campaign.leadsApprovedAt?.toISOString() ?? new Date().toISOString(),
            workspaceSlug: auditContext.workspaceSlug,
            contentHash: campaign.approvedContentHash,
          },
        },
      });
    }

    return formatCampaignDetail(campaign);
  });
}

// ---------------------------------------------------------------------------
// 10. rejectCampaignLeads — reject the lead list with feedback
// ---------------------------------------------------------------------------

/**
 * Reject the lead list for a campaign with feedback text.
 *
 * @param id - Campaign ID
 * @param feedback - Rejection reason / feedback for the admin
 * @returns Updated CampaignDetail
 */
export async function rejectCampaignLeads(
  id: string,
  feedback: string,
): Promise<CampaignDetail> {
  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      leadsApproved: false,
      leadsFeedback: feedback,
    },
    include: targetListInclude,
  });
  return formatCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// 11. approveCampaignContent — approve the email/LinkedIn content
// ---------------------------------------------------------------------------

/**
 * Approve the campaign content (email/LinkedIn sequences).
 *
 * Sets contentApproved: true, clears previous feedback, sets timestamp.
 * If leadsApproved is also true and status is 'pending_approval',
 * auto-transitions the campaign to 'approved'.
 *
 * @param id - Campaign ID
 * @returns Updated CampaignDetail
 * @throws If campaign not found
 */
export async function approveCampaignContent(
  id: string,
  auditContext?: ApprovalAuditContext,
): Promise<CampaignDetail> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.campaign.findUnique({
      where: { id },
      select: {
        leadsApproved: true,
        status: true,
        emailSequence: true,
        linkedinSequence: true,
      },
    });

    if (!current) throw new Error(`Campaign not found: '${id}'`);
    const approvedArtifact = createApprovedContentArtifact({
      emailSequence: parseJsonArray(current.emailSequence),
      linkedinSequence: parseJsonArray(current.linkedinSequence),
    });

    const updateData: Record<string, unknown> = {
      contentApproved: true,
      contentApprovedAt: new Date(),
      contentFeedback: null,
      approvedContentHash: approvedArtifact.approvedContentHash,
      approvedContentSnapshot: approvedArtifact.approvedContentSnapshot,
    };

    if (current.leadsApproved && current.status === "pending_approval") {
      updateData.status = "approved";
    }

    const campaign = await tx.campaign.update({
      where: { id },
      data: updateData,
      include: targetListInclude,
    });

    if (auditContext) {
      await tx.auditLog.create({
        data: {
          action: "campaign.approve_content",
          entityType: "Campaign",
          entityId: id,
          adminEmail: auditContext.adminEmail,
          metadata: {
            actorRole: auditContext.actorRole ?? "client",
            campaignName: auditContext.campaignName,
            previousStatus: current.status,
            newStatus: campaign.status,
            approvedAt:
              campaign.contentApprovedAt?.toISOString() ??
              new Date().toISOString(),
            workspaceSlug: auditContext.workspaceSlug,
            contentHash: campaign.approvedContentHash,
          },
        },
      });
    }

    return formatCampaignDetail(campaign);
  });
}

// ---------------------------------------------------------------------------
// 12. rejectCampaignContent — reject the content with feedback
// ---------------------------------------------------------------------------

/**
 * Reject the campaign content with feedback text.
 *
 * @param id - Campaign ID
 * @param feedback - Rejection reason / feedback for the admin
 * @returns Updated CampaignDetail
 */
export async function rejectCampaignContent(
  id: string,
  feedback: string,
): Promise<CampaignDetail> {
  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      contentApproved: false,
      contentFeedback: feedback,
    },
    include: targetListInclude,
  });
  return formatCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// 13. getCampaignLeadSample — fetch top N leads from a target list by ICP score
// ---------------------------------------------------------------------------

export interface LeadSample {
  personId: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  linkedinUrl: string | null;
  icpScore: number | null;
}

/**
 * Fetch a sample of leads from a target list, ordered by ICP score descending.
 *
 * ICP score is workspace-specific (lives on PersonWorkspace), so workspaceSlug
 * is required to avoid cross-workspace score leakage.
 *
 * @param targetListId - TargetList ID to sample from
 * @param workspaceSlug - Workspace slug for ICP score filtering
 * @param limit - Max leads to return (default 50)
 * @returns { leads: LeadSample[], totalCount: number }
 */
export async function getCampaignLeadSample(
  targetListId: string,
  workspaceSlug: string,
  limit = 50,
): Promise<{ leads: LeadSample[]; totalCount: number }> {
  const [members, totalCount] = await Promise.all([
    prisma.targetListPerson.findMany({
      where: { listId: targetListId },
      include: {
        person: {
          include: {
            workspaces: {
              where: { workspace: workspaceSlug },
              select: { icpScore: true },
            },
          },
        },
      },
    }),
    prisma.targetListPerson.count({ where: { listId: targetListId } }),
  ]);

  const leads = members
    .map((m) => ({
      personId: m.person.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      jobTitle: m.person.jobTitle,
      company: m.person.company,
      location: m.person.location,
      linkedinUrl: m.person.linkedinUrl,
      icpScore: m.person.workspaces[0]?.icpScore ?? null,
    }))
    .sort((a, b) => (b.icpScore ?? -1) - (a.icpScore ?? -1))
    .slice(0, limit);

  return { leads, totalCount };
}
