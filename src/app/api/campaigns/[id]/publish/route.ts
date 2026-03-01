import { NextResponse } from "next/server";
import { publishForReview } from "@/lib/campaigns/operations";

// POST /api/campaigns/[id]/publish — push campaign for client review
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const campaign = await publishForReview(id);

    return NextResponse.json({
      campaign,
      message: "Campaign published for client review",
    });
  } catch (err) {
    if (err instanceof Error) {
      const isValidationError =
        err.message.includes("Cannot publish campaign") ||
        err.message.includes("without content") ||
        err.message.includes("without a target list");

      if (isValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }

    console.error("[POST /api/campaigns/[id]/publish] Error:", err);
    return NextResponse.json(
      { error: "Failed to publish campaign" },
      { status: 500 },
    );
  }
}
