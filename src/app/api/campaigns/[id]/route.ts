import { NextResponse } from "next/server";
import {
  getCampaign,
  updateCampaign,
  deleteCampaign,
} from "@/lib/campaigns/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { updateCampaignSchema } from "@/lib/validations/campaigns";
import { auditLog } from "@/lib/audit";

// GET /api/campaigns/[id] — campaign detail
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const campaign = await getCampaign(id);

    if (!campaign) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ campaign });
  } catch (err) {
    console.error("[GET /api/campaigns/[id]] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch campaign" },
      { status: 500 },
    );
  }
}

// PATCH /api/campaigns/[id] — update campaign metadata
export async function PATCH(
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
    const result = updateCampaignSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }
    const { name, description, channels, targetListId } = result.data;

    const campaign = await updateCampaign(id, {
      name,
      description: description ?? undefined,
      channels,
      targetListId: targetListId ?? undefined,
    });

    return NextResponse.json({ campaign });
  } catch (err) {
    console.error("[PATCH /api/campaigns/[id]] Error:", err);
    return NextResponse.json(
      { error: "Failed to update campaign" },
      { status: 500 },
    );
  }
}

// DELETE /api/campaigns/[id] — delete campaign (draft/internal_review only)
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    await deleteCampaign(id);

    auditLog({
      action: "campaign.delete",
      entityType: "Campaign",
      entityId: id,
      adminEmail: session.email,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Cannot delete campaign in status")
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    console.error("[DELETE /api/campaigns/[id]] Error:", err);
    return NextResponse.json(
      { error: "Failed to delete campaign" },
      { status: 500 },
    );
  }
}
