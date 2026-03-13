import { NextRequest, NextResponse } from "next/server";
import { runs } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

// ---------------------------------------------------------------------------
// PATCH /api/ooo/[id] — reschedule OOO re-engagement
// Body: { oooUntil: string } — new ISO date for return
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const record = await prisma.oooReengagement.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (record.status !== "pending") {
      return NextResponse.json(
        { error: "Can only reschedule pending records" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as { oooUntil?: string };
    if (!body.oooUntil) {
      return NextResponse.json({ error: "oooUntil is required" }, { status: 400 });
    }

    const newOooUntil = new Date(body.oooUntil);
    if (isNaN(newOooUntil.getTime())) {
      return NextResponse.json({ error: "Invalid oooUntil date" }, { status: 400 });
    }

    // newSendDate = oooUntil + 1 day (re-engage the day after they return)
    const newSendDate = new Date(newOooUntil.getTime() + 24 * 60 * 60 * 1000);

    // Reschedule the Trigger.dev delayed task if we have a run ID
    if (record.triggerRunId) {
      try {
        await runs.reschedule(record.triggerRunId, { delay: newSendDate });
      } catch (triggerErr) {
        // Run may have already completed or been cancelled — log but continue
        console.warn(
          `[PATCH /api/ooo/${id}] Trigger.dev reschedule failed (run may be completed/cancelled):`,
          triggerErr,
        );
      }
    }

    const updated = await prisma.oooReengagement.update({
      where: { id },
      data: { oooUntil: newOooUntil },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error(`[PATCH /api/ooo/${id}]`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/ooo/[id] — cancel OOO re-engagement
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const record = await prisma.oooReengagement.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (record.status !== "pending") {
      return NextResponse.json(
        { error: "Can only cancel pending records" },
        { status: 400 },
      );
    }

    // Cancel the Trigger.dev delayed task if we have a run ID
    if (record.triggerRunId) {
      try {
        await runs.cancel(record.triggerRunId);
      } catch (triggerErr) {
        // Run may have already completed or been cancelled — log but continue
        console.warn(
          `[DELETE /api/ooo/${id}] Trigger.dev cancel failed (run may be completed/cancelled):`,
          triggerErr,
        );
      }
    }

    const updated = await prisma.oooReengagement.update({
      where: { id },
      data: { status: "cancelled", cancelledAt: new Date() },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error(`[DELETE /api/ooo/${id}]`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
