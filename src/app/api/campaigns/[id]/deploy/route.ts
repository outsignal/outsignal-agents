import { NextRequest, NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { prisma } from "@/lib/db";
import { getCampaign } from "@/lib/campaigns/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { auditLog } from "@/lib/audit";
import {
  initiateCampaignDeploy,
  deployFailureHttpStatus,
} from "@/lib/campaigns/deploy-campaign";

export const maxDuration = 300; // 5 minutes for background execution

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const url = new URL(request.url);
  const retryChannel = url.searchParams.get("retry") as "email" | "linkedin" | null;

  // Retry path: find latest deploy and retry the specified channel.
  // The retry branch is route-specific (driven by ?retry=) and has no CLI
  // equivalent, so it stays inline here rather than being hoisted into the
  // shared helper.
  if (retryChannel) {
    // Load campaign for audit metadata + existence check.
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (!["email", "linkedin"].includes(retryChannel)) {
      return NextResponse.json({ error: "Invalid retry channel" }, { status: 400 });
    }

    const latestDeploy = await prisma.campaignDeploy.findFirst({
      where: { campaignId: id },
      orderBy: { createdAt: "desc" },
    });

    if (!latestDeploy) {
      return NextResponse.json({ error: "No deploy to retry" }, { status: 404 });
    }

    if (latestDeploy.status !== "partial_failure" && latestDeploy.status !== "failed") {
      return NextResponse.json({ error: "Deploy is not in failed state" }, { status: 400 });
    }

    await tasks.trigger("campaign-deploy", {
      campaignId: id,
      deployId: latestDeploy.id,
      retryChannel,
    });

    auditLog({
      action: "campaign.deploy.retry",
      entityType: "Campaign",
      entityId: id,
      adminEmail: session.email,
      metadata: { campaignName: campaign.name, workspaceSlug: campaign.workspaceSlug, retryChannel },
    });

    return NextResponse.json({ deployId: latestDeploy.id, status: "retrying", channel: retryChannel });
  }

  // Non-retry path: delegate to the shared helper so the CLI and the portal
  // drive identical logic. Preserve pre-refactor HTTP status codes + response
  // shapes by mapping helper failure codes back via deployFailureHttpStatus.
  const result = await initiateCampaignDeploy({
    campaignId: id,
    adminEmail: session.email,
  });

  if (!result.ok) {
    // Map helper failure codes back to the exact error strings + status codes
    // the route returned prior to the BL-061 refactor. The portal depends on
    // these shapes (e.g. displaying a 409 as "already deployed").
    const errorText =
      result.code === "not_found"
        ? "Campaign not found"
        : result.code === "missing_approvals"
          ? "Both leads and content must be approved before deploying"
          : "Campaign is not in approved status (may have already been deployed)";
    return NextResponse.json(
      { error: errorText },
      { status: deployFailureHttpStatus(result.code) },
    );
  }

  return NextResponse.json({ deployId: result.deployId, status: "pending" });
}
