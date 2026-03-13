/**
 * POST /api/senders/[id]/email-health-override
 *
 * Admin manual override for a sender's email bounce health status.
 * Creates an EmailHealthEvent audit trail with reason 'manual'.
 * Resets consecutiveHealthyChecks to 0 on any manual change.
 * Next cron check resumes automatic evaluation after override (no locking).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

const LOG_PREFIX = "[senders/email-health-override]";

const VALID_STATUSES = ["healthy", "elevated", "warning", "critical"] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

function isValidStatus(value: unknown): value is ValidStatus {
  return VALID_STATUSES.includes(value as ValidStatus);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // 1. Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { status, reason } = body as { status?: unknown; reason?: unknown };

    if (!isValidStatus(status)) {
      return NextResponse.json(
        {
          error: "Invalid status",
          message: `status must be one of: ${VALID_STATUSES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // 2. Look up sender
    const sender = await prisma.sender.findUnique({
      where: { id },
      select: {
        id: true,
        emailAddress: true,
        workspaceSlug: true,
        emailBounceStatus: true,
      },
    });

    if (!sender) {
      return NextResponse.json({ error: "Sender not found" }, { status: 404 });
    }

    if (!sender.emailAddress) {
      return NextResponse.json(
        { error: "Sender has no email address" },
        { status: 400 },
      );
    }

    const currentStatus = sender.emailBounceStatus;

    // 3. No-op check
    if (status === currentStatus) {
      return NextResponse.json({
        message: "No change",
        currentStatus,
      });
    }

    const senderEmail = sender.emailAddress;
    const senderDomain = senderEmail.split("@")[1] ?? "";
    const detailText =
      typeof reason === "string" && reason.trim().length > 0
        ? reason.trim()
        : "Manual override by admin";

    // 4. Create audit event and update sender atomically
    const [event] = await prisma.$transaction([
      prisma.emailHealthEvent.create({
        data: {
          senderEmail,
          senderDomain,
          workspaceSlug: sender.workspaceSlug,
          fromStatus: currentStatus,
          toStatus: status,
          reason: "manual",
          bouncePct: null,
          detail: detailText,
          senderId: sender.id,
        },
      }),
      prisma.sender.update({
        where: { id: sender.id },
        data: {
          emailBounceStatus: status,
          emailBounceStatusAt: new Date(),
          consecutiveHealthyChecks: 0,
        },
      }),
    ]);

    console.log(
      `${LOG_PREFIX} Manual override: ${senderEmail} ${currentStatus} → ${status} (${detailText})`,
    );

    return NextResponse.json({
      success: true,
      from: currentStatus,
      to: status,
      eventId: event.id,
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} Error:`, error);
    return NextResponse.json({ error: "Failed to override email health status" }, { status: 500 });
  }
}
