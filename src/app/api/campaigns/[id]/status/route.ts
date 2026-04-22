import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { prisma } from "@/lib/db";
import { updateCampaignStatus } from "@/lib/campaigns/operations";
import {
  CampaignChannelSyncError,
  pauseCampaignChannels,
  resumeCampaignChannels,
} from "@/lib/campaigns/lifecycle";
import { auditLog } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { requireAdminAuth } from "@/lib/require-admin-auth";

async function createFirstLinkedInDeployIfNeeded(args: {
  campaignId: string;
  campaignName: string;
  workspaceSlug: string;
  channels: string[];
}): Promise<{ id: string } | null> {
  const { campaignId, campaignName, workspaceSlug, channels } = args;

  return prisma.$transaction(async (tx) => {
    const claimedActivation = await tx.campaign.updateMany({
      where: {
        id: campaignId,
        status: "active",
        deployedAt: null,
      },
      data: {
        deployedAt: new Date(),
      },
    });

    if (claimedActivation.count === 0) {
      return null;
    }

    return tx.campaignDeploy.create({
      data: {
        campaignId,
        campaignName,
        workspaceSlug,
        status: "pending",
        channels: JSON.stringify(channels),
        emailStatus: channels.includes("email") ? "pending" : "skipped",
        linkedinStatus: channels.includes("linkedin") ? "pending" : "skipped",
      },
      select: { id: true },
    });
  });
}

function describeChannelSyncFailure(error: unknown): {
  summary: string;
  failures?: Array<{ channel: string; error: string }>;
} {
  if (error instanceof CampaignChannelSyncError) {
    return {
      summary: error.message,
      failures: error.failures,
    };
  }

  const summary = error instanceof Error ? error.message : String(error);
  return { summary };
}

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
      // First activation for LinkedIn campaigns creates the initial deploy exactly once.
      // Re-activations after pause already have deployedAt / prior deploy history and
      // should just resume channels instead of creating duplicate deploy rows.
      if (campaign.channels.includes("linkedin")) {
        const deploy = await createFirstLinkedInDeployIfNeeded({
          campaignId: id,
          campaignName: campaign.name,
          workspaceSlug: campaign.workspaceSlug,
          channels: campaign.channels,
        });

        if (deploy) {
          await tasks.trigger("campaign-deploy", {
            campaignId: id,
            deployId: deploy.id,
          });

          console.log(
            `[campaign-status] Auto-triggered deploy ${deploy.id} for LinkedIn campaign ${id}`,
          );
        } else {
          // Re-activation / duplicate request — restart channel sending via adapters.
          resumeCampaignChannels(id).catch((err) =>
            console.error(`[campaign-status] Resume channels failed for ${id}:`, err),
          );
        }
      } else {
        resumeCampaignChannels(id).catch((err) =>
          console.error(`[campaign-status] Resume channels failed for ${id}:`, err),
        );
      }
    }

    if (status === "paused") {
      try {
        await pauseCampaignChannels(id);
      } catch (err) {
        const failure = describeChannelSyncFailure(err);
        console.error(`[campaign-status] Pause channels failed for ${id}:`, err);
        auditLog({
          action: "campaign.pause.sync_failed",
          entityType: "Campaign",
          entityId: id,
          adminEmail: session.email,
          metadata: {
            campaignName: campaign.name,
            workspaceSlug: campaign.workspaceSlug,
            failures: failure.failures,
            error: failure.summary,
          },
        });
        await notify({
          type: "error",
          severity: "warning",
          title: "Campaign paused locally but channel sync failed",
          workspaceSlug: campaign.workspaceSlug,
          message:
            `Campaign "${campaign.name}" is paused in Outsignal, but at least one downstream channel failed to pause. ` +
            `Check EmailBison/vendor state. ${failure.summary}`,
          metadata: {
            campaignId: id,
            campaignName: campaign.name,
            failures: failure.failures,
          },
        });
      }
    }

    return NextResponse.json(campaign);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    if (message.includes("Invalid status transition")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (message.includes("modified concurrently")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    console.error("Failed to update campaign status:", error);
    return NextResponse.json(
      { error: "Failed to update campaign status" },
      { status: 500 },
    );
  }
}
