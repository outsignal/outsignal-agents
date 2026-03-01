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

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface CreateCampaignParams {
  workspaceSlug: string;
  name: string;
  description?: string;
  channels?: string[]; // ["email"], ["linkedin"], or ["email", "linkedin"]
  targetListId?: string;
}

export interface UpdateCampaignParams {
  name?: string;
  description?: string;
  channels?: string[];
  targetListId?: string;
}

export interface CampaignSummary {
  id: string;
  name: string;
  workspaceSlug: string;
  status: string;
  channels: string[];
  targetListName: string | null;
  leadsApproved: boolean;
  contentApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignDetail extends CampaignSummary {
  description: string | null;
  emailSequence: unknown[] | null; // parsed JSON
  linkedinSequence: unknown[] | null; // parsed JSON
  targetListId: string | null;
  targetListPeopleCount: number;
  leadsFeedback: string | null;
  leadsApprovedAt: Date | null;
  contentFeedback: string | null;
  contentApprovedAt: Date | null;
  emailBisonCampaignId: number | null;
  publishedAt: Date | null;
  deployedAt: Date | null;
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
  paused: ["active", "completed"],
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
 * Shape a raw Prisma Campaign record into CampaignDetail.
 */
function formatCampaignDetail(
  raw: {
    id: string;
    name: string;
    workspaceSlug: string;
    status: string;
    channels: string;
    description: string | null;
    emailSequence: string | null;
    linkedinSequence: string | null;
    targetListId: string | null;
    leadsApproved: boolean;
    leadsFeedback: string | null;
    leadsApprovedAt: Date | null;
    contentApproved: boolean;
    contentFeedback: string | null;
    contentApprovedAt: Date | null;
    emailBisonCampaignId: number | null;
    publishedAt: Date | null;
    deployedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
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
    status: raw.status,
    channels: parseJsonArray(raw.channels) as string[] ?? ["email"],
    targetListName: raw.targetList?.name ?? null,
    leadsApproved: raw.leadsApproved,
    contentApproved: raw.contentApproved,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    description: raw.description,
    emailSequence: parseJsonArray(raw.emailSequence),
    linkedinSequence: parseJsonArray(raw.linkedinSequence),
    targetListId: raw.targetListId,
    targetListPeopleCount: raw.targetList?._count.people ?? 0,
    leadsFeedback: raw.leadsFeedback,
    leadsApprovedAt: raw.leadsApprovedAt,
    contentFeedback: raw.contentFeedback,
    contentApprovedAt: raw.contentApprovedAt,
    emailBisonCampaignId: raw.emailBisonCampaignId,
    publishedAt: raw.publishedAt,
    deployedAt: raw.deployedAt,
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
  const { workspaceSlug, name, description, channels, targetListId } = params;

  // Validate workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { slug: true },
  });

  if (!workspace) {
    throw new Error(`Workspace not found: '${workspaceSlug}'`);
  }

  const resolvedChannels = channels && channels.length > 0 ? channels : ["email"];

  const campaign = await prisma.campaign.create({
    data: {
      workspaceSlug,
      name,
      description,
      channels: JSON.stringify(resolvedChannels),
      targetListId: targetListId ?? null,
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
        select: { name: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    workspaceSlug: c.workspaceSlug,
    status: c.status,
    channels: parseJsonArray(c.channels) as string[] ?? ["email"],
    targetListName: c.targetList?.name ?? null,
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
 *   paused -> active | completed
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
    select: { status: true },
  });

  if (!current) {
    throw new Error(`Campaign not found: '${id}'`);
  }

  const currentStatus = current.status;

  // Allow any -> completed
  if (newStatus !== "completed") {
    const allowedTransitions = VALID_TRANSITIONS[currentStatus] ?? [];
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

  const campaign = await prisma.campaign.update({
    where: { id },
    data: { status: newStatus },
    include: targetListInclude,
  });

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
    select: { status: true },
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

  await prisma.campaign.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// 7. publishForReview — push campaign to pending_approval
// ---------------------------------------------------------------------------

/**
 * Publish a campaign for client review by transitioning to "pending_approval".
 *
 * Validates:
 *   - Current status is "internal_review"
 *   - Campaign has at least one sequence (emailSequence or linkedinSequence)
 *   - Campaign has a targetListId (leads must be linked)
 *
 * Sets publishedAt to the current timestamp.
 *
 * @param id - Campaign ID
 * @returns Updated CampaignDetail
 * @throws If validation fails
 */
export async function publishForReview(id: string): Promise<CampaignDetail> {
  const current = await prisma.campaign.findUnique({
    where: { id },
    select: {
      status: true,
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

  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      status: "pending_approval",
      publishedAt: new Date(),
    },
    include: targetListInclude,
  });

  return formatCampaignDetail(campaign);
}

// ---------------------------------------------------------------------------
// 8. saveCampaignSequences — store email and/or LinkedIn sequences
// ---------------------------------------------------------------------------

/**
 * Save campaign sequence content. Only provided sequences are updated —
 * passing undefined for a sequence leaves it unchanged.
 *
 * @param id - Campaign ID
 * @param data - { emailSequence?, linkedinSequence? }
 * @returns Updated CampaignDetail
 */
export async function saveCampaignSequences(
  id: string,
  data: { emailSequence?: unknown[]; linkedinSequence?: unknown[] },
): Promise<CampaignDetail> {
  const { emailSequence, linkedinSequence } = data;

  const updateData: Record<string, unknown> = {};
  if (emailSequence !== undefined) {
    updateData.emailSequence = JSON.stringify(emailSequence);
  }
  if (linkedinSequence !== undefined) {
    updateData.linkedinSequence = JSON.stringify(linkedinSequence);
  }

  const campaign = await prisma.campaign.update({
    where: { id },
    data: updateData,
    include: targetListInclude,
  });

  return formatCampaignDetail(campaign);
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
export async function approveCampaignLeads(id: string): Promise<CampaignDetail> {
  const current = await prisma.campaign.findUnique({
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

  const campaign = await prisma.campaign.update({
    where: { id },
    data: updateData,
    include: targetListInclude,
  });

  return formatCampaignDetail(campaign);
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
export async function approveCampaignContent(id: string): Promise<CampaignDetail> {
  const current = await prisma.campaign.findUnique({
    where: { id },
    select: { leadsApproved: true, status: true },
  });

  if (!current) throw new Error(`Campaign not found: '${id}'`);

  const updateData: Record<string, unknown> = {
    contentApproved: true,
    contentApprovedAt: new Date(),
    contentFeedback: null,
  };

  if (current.leadsApproved && current.status === "pending_approval") {
    updateData.status = "approved";
  }

  const campaign = await prisma.campaign.update({
    where: { id },
    data: updateData,
    include: targetListInclude,
  });

  return formatCampaignDetail(campaign);
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
