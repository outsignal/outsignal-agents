import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { prisma } from "@/lib/db";

/**
 * PATCH /api/linkedin/senders/[id]/health
 * Update the health status of a sender.
 * Worker-only endpoint — called when the worker detects auth failures, IP blocks, or checkpoints.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();

    const validStatuses = ["healthy", "warning", "paused", "blocked", "session_expired"];
    if (!body.healthStatus || !validStatuses.includes(body.healthStatus)) {
      return NextResponse.json(
        { error: `Invalid healthStatus. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    await prisma.sender.update({
      where: { id },
      data: {
        healthStatus: body.healthStatus,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Update health error:", error);
    return NextResponse.json(
      { error: "Failed to update health status" },
      { status: 500 },
    );
  }
}
