import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";
import { parseModules, getWorkspaceQuotaUsage } from "@/lib/workspaces/quota";

export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspaces = await prisma.workspace.findMany({
      orderBy: { name: "asc" },
      select: {
        slug: true,
        name: true,
        status: true,
        enabledModules: true,
        monthlyLeadQuota: true,
        monthlyLeadQuotaStatic: true,
        monthlyLeadQuotaSignal: true,
        monthlyCampaignAllowance: true,
      },
    });

    const usageResults = await Promise.allSettled(
      workspaces.map((ws) => getWorkspaceQuotaUsage(ws.slug)),
    );

    const packages = workspaces.map((ws, i) => {
      const usageResult = usageResults[i];
      const usage =
        usageResult.status === "fulfilled"
          ? usageResult.value
          : { totalLeadsUsed: 0, campaignsUsed: 0 };
      const modules = parseModules(ws.enabledModules);
      return {
        slug: ws.slug,
        name: ws.name,
        status: ws.status,
        modules,
        leadQuota: ws.monthlyLeadQuota,
        leadsUsed: usage.totalLeadsUsed,
        campaignAllowance: ws.monthlyCampaignAllowance,
        campaignsUsed: usage.campaignsUsed,
      };
    });

    return NextResponse.json({ packages });
  } catch {
    return NextResponse.json({ error: "Failed to fetch packages" }, { status: 500 });
  }
}
