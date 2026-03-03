import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { getCampaign, updateCampaignStatus } from "@/lib/campaigns/operations";
import { executeDeploy, retryDeployChannel } from "@/lib/campaigns/deploy";

export const maxDuration = 300; // 5 minutes for background execution

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    return NextResponse.json({ deployId: latestDeploy.id, status: "retrying", channel: retryChannel });
  }

  // Fresh deploy: validate status
  if (campaign.status !== "approved") {
    return NextResponse.json(
      { error: `Campaign must be in 'approved' status to deploy. Current: '${campaign.status}'` },
      { status: 400 },
    );
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

  // Transition campaign to 'deployed' (serves as mutex — prevents double deploy)
  await updateCampaignStatus(id, "deployed");

  // Fire-and-forget — execute deploy in background after response
  after(async () => {
    await executeDeploy(id, deploy.id);
  });

  return NextResponse.json({ deployId: deploy.id, status: "pending" });
}
