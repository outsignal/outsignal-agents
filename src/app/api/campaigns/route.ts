import { NextResponse } from "next/server";
import {
  listCampaigns,
  createCampaign,
} from "@/lib/campaigns/operations";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { createCampaignSchema } from "@/lib/validations/campaigns";

// GET /api/campaigns?workspace=slug — list campaigns for workspace
export async function GET(request: Request) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get("workspace")?.trim();

    if (!workspace) {
      return NextResponse.json(
        { error: "workspace query parameter is required" },
        { status: 400 },
      );
    }

    const campaigns = await listCampaigns(workspace);

    return NextResponse.json({ campaigns });
  } catch (err) {
    console.error("[GET /api/campaigns] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch campaigns" },
      { status: 500 },
    );
  }
}

// POST /api/campaigns — create new campaign
export async function POST(request: Request) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = createCampaignSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }

    const { name, workspaceSlug, description, channels, targetListId } = result.data;

    const campaign = await createCampaign({
      name: name.trim(),
      workspaceSlug: workspaceSlug.trim(),
      description,
      channels,
      targetListId,
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/campaigns] Error:", err);
    return NextResponse.json(
      { error: "Failed to create campaign" },
      { status: 500 },
    );
  }
}
