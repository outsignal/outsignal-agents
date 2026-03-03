import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// CRON_SECRET guards this endpoint on Vercel
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  // Verify cron secret (Vercel sends Authorization header)
  const authHeader = request.headers.get("authorization");
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const SIX_DAYS_AGO = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

    // Find active senders with sessions older than 6 days
    const staleSenders = await prisma.sender.findMany({
      where: {
        status: "active",
        sessionStatus: "active",
        updatedAt: { lt: SIX_DAYS_AGO },
        // Only senders with session data (have been authenticated)
        sessionData: { not: null },
      },
      select: {
        id: true,
        name: true,
        workspaceSlug: true,
        updatedAt: true,
      },
    });

    if (staleSenders.length === 0) {
      return NextResponse.json({ message: "No stale sessions found", count: 0 });
    }

    // Flag each stale sender for re-auth
    // Set sessionStatus to 'expired' — this prevents the worker from using them
    // and signals to the admin that re-auth is needed (visible on sender cards)
    const flagged: string[] = [];
    for (const sender of staleSenders) {
      await prisma.sender.update({
        where: { id: sender.id },
        data: {
          sessionStatus: "expired",
          healthStatus: "session_expired",
        },
      });

      // Create a health event for audit trail
      await prisma.senderHealthEvent.create({
        data: {
          senderId: sender.id,
          status: "session_expired",
          reason: "session_expired",
          detail: `Proactive session refresh: session last updated ${sender.updatedAt.toISOString()}, older than 6 days`,
        },
      });

      flagged.push(`${sender.name} (${sender.workspaceSlug})`);
    }

    console.log(`[Session Refresh] Flagged ${flagged.length} stale sender sessions:`, flagged);

    return NextResponse.json({
      message: `Flagged ${flagged.length} sender sessions for re-auth`,
      count: flagged.length,
      senders: flagged,
    });
  } catch (error) {
    console.error("[Session Refresh] Error:", error);
    return NextResponse.json({ error: "Session refresh failed" }, { status: 500 });
  }
}
