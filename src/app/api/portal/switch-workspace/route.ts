import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { createSessionCookie } from "@/lib/portal-auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { email } = await getPortalSession();
    const { workspaceSlug } = await request.json();

    if (!workspaceSlug || typeof workspaceSlug !== "string") {
      return NextResponse.json({ error: "Missing workspaceSlug" }, { status: 400 });
    }

    // Verify the target workspace exists and the user has access
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { notificationEmails: true, status: true },
    });

    if (!workspace || workspace.status !== "active") {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const emails: string[] = JSON.parse(workspace.notificationEmails || "[]");
    const hasAccess = emails.some((e) => e.toLowerCase() === email.toLowerCase());

    if (!hasAccess) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Create new session cookie for the target workspace
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const cookie = createSessionCookie({ workspaceSlug, email, exp });

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
