import { NextResponse } from "next/server";
import {
  listCampaigns,
  createCampaign,
} from "@/lib/campaigns/operations";

// GET /api/campaigns?workspace=slug — list campaigns for workspace
export async function GET(request: Request) {
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
  try {
    const body = await request.json();
    const { name, workspaceSlug, description, channels, targetListId } = body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 },
      );
    }

    if (
      !workspaceSlug ||
      typeof workspaceSlug !== "string" ||
      !workspaceSlug.trim()
    ) {
      return NextResponse.json(
        { error: "workspaceSlug is required" },
        { status: 400 },
      );
    }

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
