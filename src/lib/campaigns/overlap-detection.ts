/**
 * Cross-campaign overlap detection.
 *
 * Finds people who appear in other active or recently completed campaigns
 * for the same workspace. Match on email OR LinkedIn URL.
 */

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OverlapResult {
  personId: string;
  personEmail: string | null;
  personLinkedinUrl: string | null;
  personName: string | null;
  overlappingCampaignId: string;
  overlappingCampaignName: string;
  overlapField: "email" | "linkedinUrl";
}

// Active campaign statuses — these campaigns are "in-flight"
const ACTIVE_STATUSES = [
  "draft",
  "internal_review",
  "pending_approval",
  "approved",
  "deployed",
  "active",
];

// ---------------------------------------------------------------------------
// detectOverlaps
// ---------------------------------------------------------------------------

/**
 * Finds people who appear in other active/recent campaigns for the same workspace.
 *
 * Checks against:
 * 1. Campaigns with an active status (draft through active)
 * 2. Campaigns completed within the last 30 days
 *
 * Matches on Person.email OR Person.linkedinUrl.
 */
export async function detectOverlaps(params: {
  workspaceSlug: string;
  candidatePersonIds: string[];
  excludeCampaignId?: string;
}): Promise<OverlapResult[]> {
  const { workspaceSlug, candidatePersonIds, excludeCampaignId } = params;

  if (candidatePersonIds.length === 0) return [];

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get candidate people with their email and LinkedIn URLs
  const candidates = await prisma.person.findMany({
    where: { id: { in: candidatePersonIds } },
    select: { id: true, email: true, linkedinUrl: true, firstName: true, lastName: true },
  });

  if (candidates.length === 0) return [];

  const candidateEmails = candidates
    .map((c) => c.email)
    .filter((e): e is string => Boolean(e && e.trim()));

  const candidateLinkedInUrls = candidates
    .map((c) => c.linkedinUrl)
    .filter((u): u is string => Boolean(u && u.trim()));

  // Find TargetListPerson records in other campaigns that overlap
  // We need to join through TargetList -> Campaign
  const overlappingRecords = await prisma.targetListPerson.findMany({
    where: {
      list: {
        campaigns: {
          some: {
            workspaceSlug,
            ...(excludeCampaignId ? { id: { not: excludeCampaignId } } : {}),
            OR: [
              { status: { in: ACTIVE_STATUSES } },
              {
                status: "completed",
                updatedAt: { gte: thirtyDaysAgo },
              },
            ],
          },
        },
      },
      person: {
        OR: [
          ...(candidateEmails.length > 0 ? [{ email: { in: candidateEmails } }] : []),
          ...(candidateLinkedInUrls.length > 0 ? [{ linkedinUrl: { in: candidateLinkedInUrls } }] : []),
        ],
      },
    },
    include: {
      person: {
        select: { id: true, email: true, linkedinUrl: true, firstName: true, lastName: true },
      },
      list: {
        select: {
          campaigns: {
            where: {
              workspaceSlug,
              ...(excludeCampaignId ? { id: { not: excludeCampaignId } } : {}),
              OR: [
                { status: { in: ACTIVE_STATUSES } },
                {
                  status: "completed",
                  updatedAt: { gte: thirtyDaysAgo },
                },
              ],
            },
            select: { id: true, name: true },
          },
        },
      },
    },
  });

  // Build overlap results
  const results: OverlapResult[] = [];
  const seen = new Set<string>(); // Deduplicate by personId+campaignId

  // Build lookup sets for fast matching
  const candidateEmailSet = new Set(candidateEmails.map((e) => e.toLowerCase()));
  const candidateLinkedInSet = new Set(candidateLinkedInUrls.map((u) => u.toLowerCase()));

  for (const record of overlappingRecords) {
    const person = record.person;
    const campaigns = record.list.campaigns;

    for (const campaign of campaigns) {
      const key = `${person.id}:${campaign.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Determine which field matched
      const emailMatch = person.email && candidateEmailSet.has(person.email.toLowerCase());
      const linkedInMatch = person.linkedinUrl && candidateLinkedInSet.has(person.linkedinUrl.toLowerCase());

      const overlapField: "email" | "linkedinUrl" = emailMatch ? "email" : "linkedinUrl";

      // Only include if this person is actually one of our candidates
      if (!emailMatch && !linkedInMatch) continue;

      results.push({
        personId: person.id,
        personEmail: person.email,
        personLinkedinUrl: person.linkedinUrl,
        personName: [person.firstName, person.lastName].filter(Boolean).join(" ") || null,
        overlappingCampaignId: campaign.id,
        overlappingCampaignName: campaign.name,
        overlapField,
      });
    }
  }

  return results;
}
