import { NextRequest, NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/linkedin/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/linkedin/workspaces
 * Returns active workspace slugs for the worker to discover dynamically.
 */
export async function GET(request: NextRequest) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspaces = await prisma.workspace.findMany({
      where: { status: "active" },
      select: { slug: true },
    });

    return NextResponse.json({ slugs: workspaces.map((w) => w.slug) });
  } catch (error) {
    console.error("List workspaces error:", error);
    return NextResponse.json({ error: "Failed to list workspaces" }, { status: 500 });
  }
}
