import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, approveCampaignContent } from "@/lib/campaigns/operations";
import { notifyApproval } from "@/lib/notifications";
import { notify } from "@/lib/notify";
import { prisma } from "@/lib/db";
import {
  runFullSequenceValidation,
  type CopyStrategy,
} from "@/lib/copy-quality";
import { canManageCampaigns } from "@/lib/member-permissions";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (campaign.workspaceSlug !== session.workspaceSlug) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canManageCampaigns(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // --- Full copy quality validation (Phase 57 — hard-block on violations) ---
  const strategy = (campaign.copyStrategy as CopyStrategy) ?? "pvp";
  const channels = campaign.channels ?? ["email"];
  const workspace = await prisma.workspace.findUnique({
    where: { slug: campaign.workspaceSlug },
    select: {
      icpCriteriaPrompt: true,
      icpIndustries: true,
    },
  });
  const businessModelContext = {
    icpCriteriaPrompt: workspace?.icpCriteriaPrompt ?? null,
    icpIndustries: workspace?.icpIndustries ?? null,
  };

  let allHardViolations: Array<{ step: number; field: string; violation: string }> = [];
  let allSoftWarnings: Array<{ step: number; field: string; violation: string }> = [];

  // Validate email sequence
  const emailSequence = campaign.emailSequence as Array<{
    position?: number;
    subjectLine?: string;
    subjectVariantB?: string;
    body?: string;
  }> | null;

  if (emailSequence && emailSequence.length > 0) {
    const emailResult = runFullSequenceValidation(emailSequence, {
      strategy,
      channel: "email",
      businessModelContext,
    });
    allHardViolations = allHardViolations.concat(emailResult.hardViolations);
    allSoftWarnings = allSoftWarnings.concat(emailResult.softWarnings);
  }

  // Validate LinkedIn sequence
  const linkedinSequence = campaign.linkedinSequence as Array<{
    position?: number;
    subjectLine?: string;
    subjectVariantB?: string;
    body?: string;
  }> | null;

  if (linkedinSequence && linkedinSequence.length > 0 && channels.includes("linkedin")) {
    const linkedinResult = runFullSequenceValidation(linkedinSequence, {
      strategy,
      channel: "linkedin",
      businessModelContext,
    });
    allHardViolations = allHardViolations.concat(
      linkedinResult.hardViolations.map((v) => ({ ...v, field: `linkedin:${v.field}` })),
    );
    allSoftWarnings = allSoftWarnings.concat(
      linkedinResult.softWarnings.map((v) => ({ ...v, field: `linkedin:${v.field}` })),
    );
  }

  // Hard violations -> HTTP 422 (approval blocked)
  if (allHardViolations.length > 0) {
    return NextResponse.json(
      {
        error: "Copy quality violations",
        violations: allHardViolations,
        warnings: allSoftWarnings,
      },
      { status: 422 },
    );
  }

  // No hard violations -> proceed with approval
  const updated = await approveCampaignContent(id, {
    adminEmail: session.email,
    actorRole: session.role,
    workspaceSlug: campaign.workspaceSlug,
    campaignName: campaign.name,
  });

  const action = updated.status === "approved" ? "both_approved" : "content_approved";

  notifyApproval({
    workspaceSlug: session.workspaceSlug,
    campaignId: id,
    campaignName: campaign.name,
    action,
    feedback: null,
  }).catch((err) => console.error("Approval notification failed:", err));

  notify({
    type: "approval",
    severity: "info",
    title: `Content approved: ${campaign.name}`,
    workspaceSlug: campaign.workspaceSlug,
    metadata: { campaignId: id },
  }).catch(() => {});

  return NextResponse.json({
    campaign: updated,
    ...(allSoftWarnings.length > 0 && {
      warnings: allSoftWarnings,
    }),
  });
}
