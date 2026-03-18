import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

/**
 * GET /api/inboxes
 * Returns all email senders (loginMethod = "none", no LinkedIn profile URL).
 */
export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const senders = await prisma.sender.findMany({
      where: {
        loginMethod: "none",
        linkedinProfileUrl: null,
      },
      include: {
        workspace: {
          select: { name: true },
        },
      },
      orderBy: [{ workspaceSlug: "asc" }, { name: "asc" }],
    });

    // Strip sensitive fields before returning
    const sanitized = senders.map(
      ({ sessionData, linkedinPassword, totpSecret, inviteToken, ...rest }) =>
        rest,
    );

    return NextResponse.json({ senders: sanitized });
  } catch (error) {
    console.error("List inboxes error:", error);
    return NextResponse.json(
      { error: "Failed to list inboxes" },
      { status: 500 },
    );
  }
}
