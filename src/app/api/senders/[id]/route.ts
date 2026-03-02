import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const ALLOWED_STATUSES = ["setup", "active", "paused", "disabled"];

/**
 * GET /api/senders/[id]
 * Returns a single sender by ID with workspace info.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const sender = await prisma.sender.findUnique({
      where: { id },
      include: {
        workspace: {
          select: { name: true },
        },
      },
    });

    if (!sender) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    const { sessionData, linkedinPassword, totpSecret, ...sanitized } = sender;
    return NextResponse.json({ sender: sanitized });
  } catch (error) {
    console.error("Get sender error:", error);
    return NextResponse.json({ error: "Failed to get sender" }, { status: 500 });
  }
}

/**
 * PATCH /api/senders/[id]
 * Updates sender fields. Accepts any subset of editable fields.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const {
      name,
      emailAddress,
      linkedinProfileUrl,
      linkedinEmail,
      proxyUrl,
      linkedinTier,
      dailyConnectionLimit,
      dailyMessageLimit,
      dailyProfileViewLimit,
      status,
    } = body;

    // Validate status if provided
    if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status '${status}'. Must be one of: ${ALLOWED_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify sender exists
    const existing = await prisma.sender.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (emailAddress !== undefined) updateData.emailAddress = emailAddress;
    if (linkedinProfileUrl !== undefined) updateData.linkedinProfileUrl = linkedinProfileUrl;
    if (linkedinEmail !== undefined) updateData.linkedinEmail = linkedinEmail;
    if (proxyUrl !== undefined) updateData.proxyUrl = proxyUrl;
    if (linkedinTier !== undefined) updateData.linkedinTier = linkedinTier;
    if (dailyConnectionLimit !== undefined) updateData.dailyConnectionLimit = Number(dailyConnectionLimit);
    if (dailyMessageLimit !== undefined) updateData.dailyMessageLimit = Number(dailyMessageLimit);
    if (dailyProfileViewLimit !== undefined) updateData.dailyProfileViewLimit = Number(dailyProfileViewLimit);
    if (status !== undefined) updateData.status = status;

    const sender = await prisma.sender.update({
      where: { id },
      data: updateData,
      include: {
        workspace: {
          select: { name: true },
        },
      },
    });

    const { sessionData, linkedinPassword, totpSecret, ...sanitized } = sender;
    return NextResponse.json({ sender: sanitized });
  } catch (error) {
    console.error("Update sender error:", error);
    return NextResponse.json({ error: "Failed to update sender" }, { status: 500 });
  }
}

/**
 * DELETE /api/senders/[id]
 * Deletes sender by ID. Blocked if sender has pending/running LinkedInActions.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify sender exists
    const existing = await prisma.sender.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    // Check for pending/running actions
    const pendingActionCount = await prisma.linkedInAction.count({
      where: {
        senderId: id,
        status: { in: ["pending", "running"] },
      },
    });

    if (pendingActionCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete sender with ${pendingActionCount} pending or running action(s). Cancel or wait for them to complete first.`,
        },
        { status: 409 }
      );
    }

    await prisma.sender.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Delete sender error:", error);
    return NextResponse.json({ error: "Failed to delete sender" }, { status: 500 });
  }
}
