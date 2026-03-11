import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

// GET /api/portal/workspace — returns workspace metadata needed by the portal inbox
export async function GET() {
  try {
    const { workspaceSlug } = await getPortalSession();

    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { package: true, name: true },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    return NextResponse.json({
      package: workspace.package,
      name: workspace.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/portal/workspace] Error:", err);
    return NextResponse.json({ error: "Failed to fetch workspace" }, { status: 500 });
  }
}
