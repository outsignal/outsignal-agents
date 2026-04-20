import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { createSessionCookie } from "@/lib/portal-auth";
import { prisma } from "@/lib/db";
import { isPortalRole } from "@/lib/portal-role";

export async function POST(request: Request) {
  try {
    const { email } = await getPortalSession();
    const { workspaceSlug } = await request.json();

    if (!workspaceSlug || typeof workspaceSlug !== "string") {
      return NextResponse.json({ error: "Missing workspaceSlug" }, { status: 400 });
    }

    // Verify the target workspace exists and the user has access via Member model
    const member = await prisma.member.findFirst({
      where: {
        email: email.toLowerCase(),
        workspaceSlug,
        status: { not: "disabled" },
      },
      include: { workspace: { select: { status: true } } },
    });

    if (!member || member.workspace.status !== "active") {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }
    if (!isPortalRole(member.role)) {
      return NextResponse.json({ error: "Workspace role is invalid" }, { status: 403 });
    }

    // Create new session cookie for the target workspace (include role)
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const cookie = createSessionCookie({ workspaceSlug, email, role: member.role, exp });

    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", cookie);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unauthorized";
    if (
      message === "No portal session cookie" ||
      message === "Invalid or expired portal session"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[POST /api/portal/switch-workspace] Error:", err);
    return NextResponse.json({ error: "Failed to switch workspace" }, { status: 500 });
  }
}
