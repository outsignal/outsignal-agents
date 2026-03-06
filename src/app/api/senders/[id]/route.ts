import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activateSender } from "@/lib/linkedin/sender";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { updateSenderSchema } from "@/lib/validations/senders";
import { auditLog } from "@/lib/audit";

const ALLOWED_STATUSES = ["setup", "active", "paused", "disabled"];

/**
 * GET /api/senders/[id]
 * Returns a single sender by ID with workspace info.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

    const { sessionData, linkedinPassword, totpSecret, inviteToken, ...sanitized } = sender;
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
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const parseResult = updateSenderSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors }, { status: 400 });
    }

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
    } = parseResult.data;

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
    if (status !== undefined) {
      // First-time activation: use activateSender() to init warmup
      if (status === "active" && existing.status !== "active" && existing.warmupDay === 0) {
        await activateSender(id);
        // activateSender sets status, warmupDay, warmupStartedAt, and initial limits
        // Don't set status again in updateData, but still allow other field updates
      } else {
        updateData.status = status;
      }
    }

    const sender = await prisma.sender.update({
      where: { id },
      data: updateData,
      include: {
        workspace: {
          select: { name: true },
        },
      },
    });

    const { sessionData, linkedinPassword, totpSecret, inviteToken, ...sanitized } = sender;
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
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
          error: "Cannot delete sender with pending or running actions. Cancel or wait for them to complete first.",
        },
        { status: 409 }
      );
    }

    await prisma.sender.delete({ where: { id } });

    auditLog({
      action: "sender.delete",
      entityType: "Sender",
      entityId: id,
      adminEmail: session.email,
      metadata: { name: existing.name, workspaceSlug: existing.workspaceSlug },
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Delete sender error:", error);
    return NextResponse.json({ error: "Failed to delete sender" }, { status: 500 });
  }
}
