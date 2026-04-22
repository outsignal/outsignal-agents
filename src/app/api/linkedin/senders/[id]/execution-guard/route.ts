import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";

/**
 * GET /api/linkedin/senders/[id]/execution-guard
 * Returns the sender's current execution-relevant state plus paused campaigns
 * in the same workspace so the worker can re-check pause conditions before
 * firing a claimed action.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const sender = await prisma.sender.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceSlug: true,
        status: true,
        healthStatus: true,
        sessionStatus: true,
      },
    });

    if (!sender) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    const pausedCampaigns = await prisma.campaign.findMany({
      where: {
        workspaceSlug: sender.workspaceSlug,
        status: "paused",
      },
      select: {
        name: true,
      },
    });

    return NextResponse.json({
      sender: {
        id: sender.id,
        status: sender.status,
        healthStatus: sender.healthStatus,
        sessionStatus: sender.sessionStatus,
      },
      pausedCampaignNames: pausedCampaigns.map((campaign) => campaign.name),
    });
  } catch (error) {
    console.error("Get sender execution guard error:", error);
    return NextResponse.json(
      { error: "Failed to get sender execution guard" },
      { status: 500 },
    );
  }
}
