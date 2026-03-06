import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseModules, getWorkspaceQuotaUsage } from "@/lib/workspaces/quota";
import type { WorkspaceModule } from "@/lib/workspaces/quota";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { updatePackageSchema } from "@/lib/validations/workspaces";

const VALID_MODULES: WorkspaceModule[] = [
  "email",
  "email-signals",
  "linkedin",
  "linkedin-signals",
];

/**
 * GET /api/workspaces/[slug]/package
 * Returns workspace package config + current quota usage.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const usage = await getWorkspaceQuotaUsage(slug);

  return NextResponse.json({
    enabledModules: parseModules(ws.enabledModules ?? '["email"]'),
    monthlyLeadQuota: ws.monthlyLeadQuota ?? 2000,
    monthlyLeadQuotaStatic: ws.monthlyLeadQuotaStatic ?? 2000,
    monthlyLeadQuotaSignal: ws.monthlyLeadQuotaSignal ?? 0,
    monthlyCampaignAllowance: ws.monthlyCampaignAllowance ?? 2,
    billingCycleAnchor: ws.billingCycleAnchor,
    usage,
  });
}

/**
 * PATCH /api/workspaces/[slug]/package
 * Update workspace package configuration.
 * Body: { enabledModules?, monthlyLeadQuota?, monthlyLeadQuotaStatic?,
 *         monthlyLeadQuotaSignal?, monthlyCampaignAllowance? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const parseResult = updatePackageSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors }, { status: 400 });
    }
    const validated = parseResult.data;
    const updateData: Record<string, unknown> = {};

    // Validate and set enabledModules
    if (validated.enabledModules !== undefined) {
      if (!Array.isArray(validated.enabledModules)) {
        return NextResponse.json(
          { error: "enabledModules must be an array" },
          { status: 400 },
        );
      }
      const invalid = (validated.enabledModules as string[]).filter(
        (m) => !VALID_MODULES.includes(m as WorkspaceModule),
      );
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Invalid modules: ${invalid.join(", ")}` },
          { status: 400 },
        );
      }
      if ((validated.enabledModules as string[]).length === 0) {
        return NextResponse.json(
          { error: "At least one module must be enabled" },
          { status: 400 },
        );
      }
      updateData.enabledModules = JSON.stringify(validated.enabledModules);
    }

    // Validate and set numeric fields
    const numericFields = [
      "monthlyLeadQuota",
      "monthlyLeadQuotaStatic",
      "monthlyLeadQuotaSignal",
      "monthlyCampaignAllowance",
    ] as const;

    for (const field of numericFields) {
      if (validated[field as keyof typeof validated] !== undefined) {
        const val = Number(validated[field as keyof typeof validated]);
        if (!Number.isFinite(val) || val < 0) {
          return NextResponse.json(
            { error: `${field} must be a non-negative number` },
            { status: 400 },
          );
        }
        updateData[field] = Math.floor(val);
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const updated = await prisma.workspace.update({
      where: { slug },
      data: updateData,
    });

    return NextResponse.json({
      enabledModules: parseModules(updated.enabledModules ?? '["email"]'),
      monthlyLeadQuota: updated.monthlyLeadQuota ?? 2000,
      monthlyLeadQuotaStatic: updated.monthlyLeadQuotaStatic ?? 2000,
      monthlyLeadQuotaSignal: updated.monthlyLeadQuotaSignal ?? 0,
      monthlyCampaignAllowance: updated.monthlyCampaignAllowance ?? 2,
    });
  } catch (error) {
    console.error("[package] Update error:", error);
    return NextResponse.json(
      { error: "Failed to update package" },
      { status: 500 },
    );
  }
}
