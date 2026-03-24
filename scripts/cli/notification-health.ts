/**
 * notification-health.ts
 *
 * CLI wrapper: get notification health summary for a time range.
 * Usage: node dist/cli/notification-health.js [range]
 *
 * range: 24h (default) | 7d | 30d
 * Replicates the logic from src/app/api/notification-health/route.ts
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";

const [, , range] = process.argv;
const validRange = range === "7d" || range === "30d" ? range : "24h";

runWithHarness("notification-health [range]", async () => {
  const hours = validRange === "30d" ? 720 : validRange === "7d" ? 168 : 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Summary counts
  const statusCounts = await prisma.notificationAuditLog.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: true,
  });

  const sent = statusCounts.find((s) => s.status === "sent")?._count ?? 0;
  const failed = statusCounts.find((s) => s.status === "failed")?._count ?? 0;
  const skipped = statusCounts.find((s) => s.status === "skipped")?._count ?? 0;
  const total = sent + failed + skipped;
  const failureRate = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0;

  // By notification type
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

  return {
    range: validRange,
    since: since.toISOString(),
    summary: { total, sent, failed, skipped, failureRate },
    byType: byType.map(row => ({
      type: row.notificationType,
      total: Number(row.total),
      sent: Number(row.sent),
      failed: Number(row.failed),
      lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
    })),
  };
});
