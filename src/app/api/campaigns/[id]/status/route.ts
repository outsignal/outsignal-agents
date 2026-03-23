import { NextResponse } from "next/server";
import { updateCampaignStatus } from "@/lib/campaigns/operations";
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
