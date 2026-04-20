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

    // Allow keepalive-only, health-only, or profile URL-only updates
    if (!body.healthStatus && !body.lastKeepaliveAt && !body.linkedinProfileUrl) {
      return NextResponse.json(
        { error: `Must provide healthStatus, lastKeepaliveAt, or linkedinProfileUrl` },
        { status: 400 },
      );
    }

    if (body.healthStatus && !validStatuses.includes(body.healthStatus)) {
      return NextResponse.json(
        { error: `Invalid healthStatus. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    const sender =
      body.healthStatus || body.lastKeepaliveAt
        ? await prisma.sender.findUnique({
            where: { id },
            select: { sessionStatus: true, healthStatus: true },
          })
        : null;

    const updateData: Record<string, unknown> = {};
    if (body.healthStatus) {
      updateData.healthStatus = body.healthStatus;
      if (body.healthStatus === "session_expired" || body.healthStatus === "blocked") {
        updateData.sessionStatus = "expired";
      } else if (body.healthStatus === "healthy" && sender?.sessionStatus === "expired") {
        updateData.sessionStatus = "active";
      }
    }
    if (body.lastKeepaliveAt) updateData.lastKeepaliveAt = new Date(body.lastKeepaliveAt);
    if (
      body.lastKeepaliveAt &&
      !body.healthStatus &&
      sender?.sessionStatus === "active" &&
      (sender.healthStatus === "session_expired" || sender.healthStatus === "blocked")
    ) {
      updateData.healthStatus = "healthy";
    }
    if (body.linkedinProfileUrl) updateData.linkedinProfileUrl = body.linkedinProfileUrl;

    await prisma.sender.update({
      where: { id },
      data: updateData,
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
