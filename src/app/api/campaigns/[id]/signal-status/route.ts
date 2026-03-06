import { NextResponse } from "next/server";
import { updateCampaignStatus, getCampaign } from "@/lib/campaigns/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { signalStatusSchema } from "@/lib/validations/campaigns";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const result = signalStatusSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }
    const { action } = result.data;

    // Verify this is a signal campaign
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (campaign.type !== "signal") {
      return NextResponse.json(
        { error: "This endpoint is for signal campaigns only" },
        { status: 400 },
      );
    }

    const statusMap: Record<string, string> = {
      pause: "paused",
      resume: "active",
      archive: "archived",
    };

    const updated = await updateCampaignStatus(id, statusMap[action]);

    return NextResponse.json({ campaign: updated });
  } catch (err) {
    console.error("[PATCH /api/campaigns/[id]/signal-status] Error:", err);
    return NextResponse.json({ error: "Failed to update campaign status" }, { status: 500 });
  }
}
