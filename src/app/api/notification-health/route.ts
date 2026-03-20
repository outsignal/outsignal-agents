import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

// expectedFrequencyHours: how often we expect each type to fire.
// Types that fire less frequently shouldn't be flagged unhealthy in short time ranges.
const ALL_NOTIFICATION_TYPES = [
  { key: "reply", label: "Reply Received", channels: "Slack + Email", audience: "Client + Admin", expectedFrequencyHours: 24 },
  { key: "approval", label: "Campaign Approval", channels: "Slack + Email", audience: "Client", expectedFrequencyHours: 168 },
  { key: "deploy", label: "Campaign Deploy", channels: "Slack + Email", audience: "Admin", expectedFrequencyHours: 168 },
  { key: "campaign_live", label: "Campaign Live", channels: "Slack + Email", audience: "Client + Admin", expectedFrequencyHours: 168 },
  { key: "inbox_disconnect", label: "Inbox Disconnect", channels: "Email + Slack", audience: "Admin", expectedFrequencyHours: 168 },
  { key: "sender_health", label: "Inbox Health", channels: "Slack + Email", audience: "Admin", expectedFrequencyHours: 24 },
  { key: "sender_health_digest", label: "Inbox Health Digest", channels: "Slack + Email", audience: "Admin", expectedFrequencyHours: 168 },
  { key: "invoice", label: "Invoice Sent", channels: "Email", audience: "Client", expectedFrequencyHours: 720 },
  { key: "overdue_reminder", label: "Overdue Reminder", channels: "Email + Slack", audience: "Client + Admin", expectedFrequencyHours: 720 },
  { key: "onboarding_invite", label: "Onboarding Invite", channels: "Email", audience: "Client", expectedFrequencyHours: 720 },
  { key: "magic_link", label: "Portal Login", channels: "Email", audience: "Client", expectedFrequencyHours: 168 },
  { key: "proposal", label: "Proposal Ready", channels: "Email", audience: "Client", expectedFrequencyHours: 720 },
  { key: "payment_received", label: "Payment Received", channels: "Email", audience: "Client", expectedFrequencyHours: 720 },
  { key: "overdue_invoice_alert", label: "Overdue Invoice Alert", channels: "Slack", audience: "Admin", expectedFrequencyHours: 720 },
  { key: "unpaid_renewal_alert", label: "Unpaid Renewal Alert", channels: "Slack", audience: "Admin", expectedFrequencyHours: 720 },
  { key: "system", label: "System Events", channels: "Slack", audience: "Admin", expectedFrequencyHours: 24 },
  { key: "deliverability_digest", label: "Deliverability Digest", channels: "Slack + Email", audience: "Admin", expectedFrequencyHours: 168 },
] as const;

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

  // Build a lookup from audit data keyed by notification type
  const auditMap = new Map(
    byType.map((row) => [
      row.notificationType,
      {
        total: Number(row.total),
        sent: Number(row.sent),
        failed: Number(row.failed),
        lastFiredAt: row.lastFiredAt?.toISOString() ?? null,
      },
    ]),
  );

  // Merge static list with audit data
  const byTypeFormatted = ALL_NOTIFICATION_TYPES.map((nt) => {
    const audit = auditMap.get(nt.key);
    const t = audit?.total ?? 0;
    const f = audit?.failed ?? 0;
    const rate = t > 0 ? f / t : 0;
    const hoursSinceLastFired = audit?.lastFiredAt
      ? (Date.now() - new Date(audit.lastFiredAt).getTime()) / (1000 * 60 * 60)
      : Infinity;

    // Use frequency-aware thresholds: only flag as unhealthy if silent longer
    // than expected frequency + buffer (1.5x for amber, 2x for red)
    const expectedHours = nt.expectedFrequencyHours;
    let status: "green" | "amber" | "red" | "neutral" = "neutral";
    if (t > 0) {
      status = "green";
      if (rate > 0.2 || hoursSinceLastFired > expectedHours * 2) status = "red";
      else if (rate > 0.05 || hoursSinceLastFired > expectedHours * 1.5) status = "amber";
    }

    return {
      notificationType: nt.key,
      label: nt.label,
      channels: nt.channels,
      audience: nt.audience,
      total: t,
      sent: audit?.sent ?? 0,
      failed: f,
      lastFiredAt: audit?.lastFiredAt ?? null,
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
