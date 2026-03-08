import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

// GET /api/notification-health?range=24h|7d|30d
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const range = request.nextUrl.searchParams.get("range") ?? "24h";
  const hours = range === "30d" ? 720 : range === "7d" ? 168 : 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // 1. Summary counts
  const statusCounts = await prisma.notificationAuditLog.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: true,
  });

  const sent = statusCounts.find((s) => s.status === "sent")?._count ?? 0;
  const failed = statusCounts.find((s) => s.status === "failed")?._count ?? 0;
  const skipped =
    statusCounts.find((s) => s.status === "skipped")?._count ?? 0;
  const total = sent + failed + skipped;
  const failureRate =
    total > 0 ? Math.round((failed / total) * 1000) / 10 : 0;

  // 2. By notification type — use raw query for MAX(createdAt)
  const byType = (await prisma.$queryRaw`
    SELECT
      "notificationType",
      COUNT(*) as "total",
      COUNT(*) FILTER (WHERE "status" = 'sent') as "sent",
      COUNT(*) FILTER (WHERE "status" = 'failed') as "failed",
      MAX("createdAt") as "lastFiredAt"
    FROM "NotificationAuditLog"
    WHERE "createdAt" >= ${since}
    GROUP BY "notificationType"
    ORDER BY "notificationType"
  `) as Array<{
    notificationType: string;
    total: bigint;
    sent: bigint;
    failed: bigint;
    lastFiredAt: Date | null;
  }>;

  const byTypeFormatted = byType.map((row) => {
    const t = Number(row.total);
    const f = Number(row.failed);
    const rate = t > 0 ? f / t : 0;
    const hoursSinceLastFired = row.lastFiredAt
      ? (Date.now() - new Date(row.lastFiredAt).getTime()) / (1000 * 60 * 60)
      : Infinity;

    let status: "green" | "amber" | "red" = "green";
    if (rate > 0.2 || hoursSinceLastFired > 24) status = "red";
    else if (rate > 0.05 || hoursSinceLastFired > 12) status = "amber";

    return {
      notificationType: row.notificationType,
      total: t,
      sent: Number(row.sent),
      failed: f,
      lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
      status,
    };
  });

  // 3. Recent failures
  const recentFailures = await prisma.notificationAuditLog.findMany({
    where: { status: "failed", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      notificationType: true,
      channel: true,
      recipient: true,
      errorMessage: true,
      workspaceSlug: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    summary: { total, sent, failed, skipped, failureRate },
    byType: byTypeFormatted,
    recentFailures,
  });
}
