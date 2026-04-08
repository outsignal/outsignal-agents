import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { prisma } from "@/lib/db";
import { updateCampaignStatus } from "@/lib/campaigns/operations";
import { pauseCampaignChannels, resumeCampaignChannels } from "@/lib/campaigns/lifecycle";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || typeof status !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid status" },
        { status: 400 },
      );
    }

    const campaign = await updateCampaignStatus(id, status);

    // Handle channel-level side effects after the status transition.
    if (status === "active") {
      const existingDeploy = await prisma.campaignDeploy.findFirst({
        where: { campaignId: id },
        select: { id: true },
      });

      if (existingDeploy) {
        // Resuming from paused — restart channel sending via adapters
        resumeCampaignChannels(id).catch((err) =>
          console.error(`[campaign-status] Resume channels failed for ${id}:`, err),
        );
      } else {
        // First activation — auto-trigger deploy for LinkedIn campaigns
        const hasLinkedIn = campaign.channels.includes("linkedin");

        if (hasLinkedIn) {
          const channels: string[] = campaign.channels;

          const deploy = await prisma.campaignDeploy.create({
            data: {
              campaignId: id,
              campaignName: campaign.name,
              workspaceSlug: campaign.workspaceSlug,
              status: "pending",
              channels: JSON.stringify(channels),
              emailStatus: channels.includes("email") ? "pending" : "skipped",
              linkedinStatus: "pending",
            },
          });

          // Set deployedAt if not already set
          await prisma.campaign.update({
            where: { id },
            data: { deployedAt: new Date() },
          });

          await tasks.trigger("campaign-deploy", {
            campaignId: id,
            deployId: deploy.id,
          });

          console.log(
            `[campaign-status] Auto-triggered deploy ${deploy.id} for LinkedIn campaign ${id}`,
          );
        }
      }
    }

    if (status === "paused") {
      pauseCampaignChannels(id).catch((err) =>
        console.error(`[campaign-status] Pause channels failed for ${id}:`, err),
      );
    }

    return NextResponse.json(campaign);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    if (message.includes("Invalid status transition")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("Failed to update campaign status:", error);
    return NextResponse.json(
      { error: "Failed to update campaign status" },
      { status: 500 },
    );
  }
}
