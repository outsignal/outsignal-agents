import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

// GET /api/deliverability/senders?workspace=slug
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspace = request.nextUrl.searchParams.get("workspace");

    // INTENTIONAL-BROAD: deliverability view shows all inbox health rows.
    const senders = await prisma.sender.findMany({
      where: {
        emailAddress: { not: null },
        ...(workspace ? { workspaceSlug: workspace } : {}),
      },
      orderBy: { emailAddress: "asc" },
    });

    if (senders.length === 0) {
      return NextResponse.json([]);
    }

    // Batch fetch last 30 days of BounceSnapshot data for sparklines
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const senderEmails = senders
      .map((s) => s.emailAddress)
      .filter((e): e is string => !!e);

    const snapshots = await prisma.bounceSnapshot.findMany({
      where: {
        senderEmail: { in: senderEmails },
        snapshotDate: { gte: thirtyDaysAgo },
      },
      orderBy: { snapshotDate: "asc" },
      select: {
        senderEmail: true,
        snapshotDate: true,
        bounceRate: true,
      },
    });

    // Group snapshots by senderEmail
    const snapshotsBySender = new Map<
      string,
      Array<{ snapshotDate: Date; bounceRate: number | null }>
    >();
    for (const snap of snapshots) {
      const existing = snapshotsBySender.get(snap.senderEmail) ?? [];
      existing.push({ snapshotDate: snap.snapshotDate, bounceRate: snap.bounceRate });
      snapshotsBySender.set(snap.senderEmail, existing);
    }

    const result = senders.map((sender) => {
      const email = sender.emailAddress!;
      const senderSnapshots = snapshotsBySender.get(email) ?? [];

      // Current bounce rate from most recent snapshot (already sorted asc, so last is most recent)
      const latestSnapshot = senderSnapshots[senderSnapshots.length - 1];
      const currentBounceRate =
        latestSnapshot?.bounceRate !== undefined && latestSnapshot?.bounceRate !== null
          ? latestSnapshot.bounceRate
          : null;

      // Sparkline data: map to date string + bounceRate (null becomes 0)
      const sparklineData = senderSnapshots.map((snap) => ({
        date: snap.snapshotDate.toISOString().slice(0, 10), // YYYY-MM-DD
        bounceRate: snap.bounceRate ?? 0,
      }));

      return {
        id: sender.id,
        emailAddress: email,
        workspaceSlug: sender.workspaceSlug,
        emailBounceStatus: sender.emailBounceStatus,
        emailBounceStatusAt: sender.emailBounceStatusAt,
        warmupDay: sender.warmupDay,
        warmupStartedAt: sender.warmupStartedAt,
        currentBounceRate,
        sparklineData,
        consecutiveHealthyChecks: sender.consecutiveHealthyChecks,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("[deliverability/senders] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
