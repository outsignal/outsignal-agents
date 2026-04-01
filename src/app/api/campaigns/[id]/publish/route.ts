import { NextResponse } from "next/server";
import { publishForReview } from "@/lib/campaigns/operations";
import { notify } from "@/lib/notify";
import { requireAdminAuth } from "@/lib/require-admin-auth";

// POST /api/campaigns/[id]/publish — push campaign for client review
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const result = await publishForReview(id);

    notify({
      type: "system",
      severity: "info",
      title: `Campaign published for review: ${result.campaign.name}`,
      workspaceSlug: result.campaign.workspaceSlug,
      metadata: { campaignId: id },
    }).catch(() => {});

    return NextResponse.json({
      campaign: result.campaign,
      message: "Campaign published for client review",
      ...(result.warnings ? { warnings: result.warnings } : {}),
    });
  } catch (err) {
    if (err instanceof Error) {
      const isValidationError =
        err.message.includes("Cannot publish campaign") ||
        err.message.includes("without content") ||
        err.message.includes("without a target list");

      if (isValidationError) {
        let safeMessage: string;
        if (err.message.includes("Cannot publish campaign in status")) {
          safeMessage = "Campaign must be in 'internal_review' status to publish.";
        } else if (err.message.includes("without content")) {
          safeMessage = "Campaign cannot be published without content.";
        } else if (err.message.includes("without a target list")) {
          safeMessage = "Campaign cannot be published without a target list.";
        } else if (err.message.includes("list validation failed")) {
          safeMessage = err.message.replace("Cannot publish campaign — ", "");
        } else {
          safeMessage = "Cannot publish campaign.";
        }
        return NextResponse.json({ error: safeMessage }, { status: 400 });
      }
    }

    console.error("[POST /api/campaigns/[id]/publish] Error:", err);
    return NextResponse.json(
      { error: "Failed to publish campaign" },
      { status: 500 },
    );
  }
}
