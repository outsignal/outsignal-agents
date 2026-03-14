import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { executeAction } from "@/lib/insights/actions";
import { requireAdminAuth } from "@/lib/require-admin-auth";

/**
 * PATCH /api/insights/[id]
 * Body: { action: "approve" | "dismiss" | "snooze", snoozeDays?: 3 | 7 | 14 }
 *
 * Update insight status: approve (execute action), dismiss, or snooze.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { action, snoozeDays } = body as {
      action: "approve" | "dismiss" | "snooze";
      snoozeDays?: number;
    };

    if (!action || !["approve", "dismiss", "snooze"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'approve', 'dismiss', or 'snooze'" },
        { status: 400 },
      );
    }

    // Fetch the insight
    const insight = await prisma.insight.findUnique({ where: { id } });
    if (!insight) {
      return NextResponse.json(
        { error: "Insight not found" },
        { status: 404 },
      );
    }

    let updated;

    if (action === "dismiss") {
      updated = await prisma.insight.update({
        where: { id },
        data: {
          status: "dismissed",
          resolvedAt: new Date(),
          resolvedBy: "admin",
        },
      });
    } else if (action === "snooze") {
      const days = snoozeDays && [3, 7, 14].includes(snoozeDays) ? snoozeDays : 7;
      const snoozedUntil = new Date();
      snoozedUntil.setDate(snoozedUntil.getDate() + days);

      updated = await prisma.insight.update({
        where: { id },
        data: {
          status: "snoozed",
          snoozedUntil,
        },
      });
    } else {
      // action === "approve"
      // Admin has already confirmed in the UI before calling this endpoint.
      // Execute the action immediately.
      try {
        const result = await executeAction(insight);

        updated = await prisma.insight.update({
          where: { id },
          data: {
            status: "executed",
            resolvedAt: new Date(),
            resolvedBy: "admin",
            executionResult: JSON.stringify(result),
          },
        });
      } catch (execErr) {
        updated = await prisma.insight.update({
          where: { id },
          data: {
            status: "failed",
            executionResult: JSON.stringify({
              error: "Execution failed",
            }),
          },
        });
      }
    }

    // Parse JSON fields for the response
    let evidence: unknown = [];
    let actionParams: unknown = null;
    let executionResult: unknown = null;

    try {
      evidence = JSON.parse(updated.evidence);
    } catch {
      evidence = [];
    }

    if (updated.actionParams) {
      try {
        actionParams = JSON.parse(updated.actionParams);
      } catch {
        actionParams = null;
      }
    }

    if (updated.executionResult) {
      try {
        executionResult = JSON.parse(updated.executionResult);
      } catch {
        executionResult = null;
      }
    }

    return NextResponse.json({
      ...updated,
      evidence,
      actionParams,
      executionResult,
    });
  } catch (err) {
    console.error("[insights PATCH] Error:", err);
    return NextResponse.json(
      { error: "Failed to update insight" },
      { status: 500 },
    );
  }
}
