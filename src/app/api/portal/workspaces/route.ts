import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const { email } = await getPortalSession();

    const members = await prisma.member.findMany({
      where: { email: email.toLowerCase(), status: { not: "disabled" } },
      include: { workspace: { select: { slug: true, name: true, status: true } } },
    });

    const workspaces = members
      .filter((m) => m.workspace.status === "active")
      .map((m) => ({ slug: m.workspace.slug, name: m.workspace.name }));

    return NextResponse.json(workspaces);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[GET /api/portal/workspaces] Error:", err);
    return NextResponse.json({ error: "Failed to fetch workspaces" }, { status: 500 });
  }
}
