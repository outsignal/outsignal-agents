import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, approveCampaignContent } from "@/lib/campaigns/operations";
import { notifyApproval } from "@/lib/notifications";
import { notify } from "@/lib/notify";
import {
  checkSequenceQuality,
  formatSequenceViolations,
  type SequenceStepViolation,
} from "@/lib/copy-quality";

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

  // --- Copy quality gate (warn only, does NOT block approval) ---
  let copyQualityWarnings: SequenceStepViolation[] = [];

  const emailSequence = campaign.emailSequence as Array<{
    position?: number;
    subjectLine?: string;
    subjectVariantB?: string;
    body?: string;
  }> | null;

  if (emailSequence && emailSequence.length > 0) {
    copyQualityWarnings = checkSequenceQuality(emailSequence);
  }

  // Approve regardless of warnings
  const updated = await approveCampaignContent(id);

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
    ...(copyQualityWarnings.length > 0 && {
      copyQualityWarnings,
      copyQualityWarningsSummary: `Banned patterns found: ${formatSequenceViolations(copyQualityWarnings)}`,
    }),
  });
}
