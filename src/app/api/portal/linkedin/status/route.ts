import { NextResponse } from "next/server";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";

/**
 * GET /api/portal/linkedin/status
 *
 * Returns LinkedIn-connected senders for the current workspace
 * with their session and health status.
 */
export async function GET() {
  // 1. Auth via portal session
  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Fetch senders with LinkedIn channel
  const senders = await prisma.sender.findMany({
    where: {
      workspaceSlug: session.workspaceSlug,
      channel: { in: ["linkedin", "both"] },
    },
    select: {
      id: true,
      name: true,
      sessionStatus: true,
      healthStatus: true,
      lastActiveAt: true,
      loginMethod: true,
    },
  });

  return NextResponse.json(senders);
}
