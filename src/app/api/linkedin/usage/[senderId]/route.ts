import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { getSenderBudget } from "@/lib/linkedin/rate-limiter";

/**
 * GET /api/linkedin/usage/[senderId]
 * Get daily usage stats and remaining budget for a sender.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ senderId: string }> },
) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { senderId } = await params;
    const budget = await getSenderBudget(senderId);

    if (!budget) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    return NextResponse.json({ budget });
  } catch (error) {
    console.error("Get usage error:", error);
    return NextResponse.json({ error: "Failed to get usage" }, { status: 500 });
  }
}
