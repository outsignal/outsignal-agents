import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { recoverStuckActions } from "@/lib/linkedin/queue";

/**
 * POST /api/linkedin/actions/recover — Recover actions stuck in "running" status.
 * Called periodically by the worker to clean up after crashes.
 */
export async function POST(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const recovered = await recoverStuckActions();
    return NextResponse.json({ recovered });
  } catch (error) {
    console.error("Recover stuck actions error:", error);
    return NextResponse.json(
      { error: "Failed to recover stuck actions" },
      { status: 500 },
    );
  }
}
