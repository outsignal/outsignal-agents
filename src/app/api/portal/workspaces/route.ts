import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const { email } = await getPortalSession();

    const allWorkspaces = await prisma.workspace.findMany({
      where: { status: "active" },
      select: { slug: true, name: true, notificationEmails: true },
    });

    const accessible = allWorkspaces.filter((w) => {
      try {
        const emails: string[] = JSON.parse(w.notificationEmails || "[]");
        return emails.some((e) => e.toLowerCase() === email.toLowerCase());
      } catch {
        return false;
      }
    });

    return NextResponse.json(
      accessible.map(({ slug, name }) => ({ slug, name })),
    );
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
