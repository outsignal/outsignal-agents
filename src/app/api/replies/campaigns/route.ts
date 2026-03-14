import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

// GET /api/replies/campaigns?workspace=slug — distinct campaigns from replies
export async function GET(request: NextRequest) {
  try {
    await requireAdminAuth();
    const workspace = request.nextUrl.searchParams.get("workspace");

    const where = workspace ? { workspaceSlug: workspace } : {};

    const rows = await prisma.reply.findMany({
      where: {
        ...where,
        campaignId: { not: null },
        campaignName: { not: null },
      },
      select: { campaignId: true, campaignName: true },
      distinct: ["campaignId"],
      orderBy: { campaignName: "asc" },
    });

    const campaigns = rows.map((r) => ({
      campaignId: r.campaignId!,
      campaignName: r.campaignName!,
    }));

    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error("[GET /api/replies/campaigns] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaigns" },
      { status: 500 },
    );
  }
}
