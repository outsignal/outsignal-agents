import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { getCampaign } from "@/lib/campaigns/operations";
import { executeDeploy, retryDeployChannel } from "@/lib/campaigns/deploy";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { auditLog } from "@/lib/audit";

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

  // Load campaign
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Retry path: find latest deploy and retry the specified channel
  if (retryChannel) {
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

    after(async () => {
      await retryDeployChannel(latestDeploy.id, retryChannel);
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

  // Validate both approvals
  if (!campaign.leadsApproved || !campaign.contentApproved) {
    return NextResponse.json(
      { error: "Both leads and content must be approved before deploying" },
      { status: 400 },
    );
  }

  // Parse channels
  const channels: string[] = campaign.channels ?? ["email"];

  // Atomic status transition — prevents double deploy race condition
  const transitionResult = await prisma.campaign.updateMany({
    where: { id, status: "approved" },
    data: { status: "deployed", deployedAt: new Date() },
  });
  if (transitionResult.count === 0) {
    return NextResponse.json(
      { error: "Campaign is not in approved status (may have already been deployed)" },
      { status: 409 },
    );
  }

  // Create CampaignDeploy record
  const deploy = await prisma.campaignDeploy.create({
    data: {
      campaignId: id,
      campaignName: campaign.name,
      workspaceSlug: campaign.workspaceSlug,
      status: "pending",
      channels: JSON.stringify(channels),
      emailStatus: channels.includes("email") ? "pending" : "skipped",
      linkedinStatus: channels.includes("linkedin") ? "pending" : "skipped",
    },
  });

  // Fire-and-forget — execute deploy in background after response
  after(async () => {
    await executeDeploy(id, deploy.id);
  });

  auditLog({
      action: "campaign.deploy",
      entityType: "Campaign",
      entityId: id,
      adminEmail: session.email,
      metadata: { campaignName: campaign.name, workspaceSlug: campaign.workspaceSlug, channels },
    });

  return NextResponse.json({ deployId: deploy.id, status: "pending" });
}
