import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

export const dynamic = "force-dynamic";

interface CampaignSnapshot {
  emailsSent: number;
  opened: number;
  uniqueOpens: number;
  replied: number;
  uniqueReplies: number;
  bounced: number;
  interested: number;
  totalLeads: number;
  totalLeadsContacted: number;
  linkedinConnectionsSent: number;
  linkedinConnectionsAccepted: number;
  linkedinMessagesSent: number;
  linkedinProfileViews: number;
  classifiedReplies: number;
  interestedReplies: number;
  objectionReplies: number;
  stepStats?: Array<{
    step: number;
    channel: "email" | "linkedin";
    sent: number;
    replied: number;
    interestedCount: number;
    objectionCount: number;
  }>;
  replyRate: number;
  openRate: number;
  bounceRate: number;
  interestedRate: number;
  campaignName: string;
  channels: string[];
  copyStrategy: string | null;
  status: string;
}

type SortableField =
  | "replyRate"
  | "openRate"
  | "bounceRate"
  | "interestedRate"
  | "sent"
  | "replied"
  | "opened"
  | "bounced"
  | "interested"
  | "name";

const VALID_SORTS = new Set<string>([
  "replyRate",
  "openRate",
  "bounceRate",
  "interestedRate",
  "sent",
  "replied",
  "opened",
  "bounced",
  "interested",
  "name",
]);

function getDateRange(period: string): { gte?: string; lte?: string } {
  if (period === "all") return {};
  const now = new Date();
  const lte = now.toISOString().slice(0, 10);
  if (period === "24h") {
    return { gte: lte, lte };
  }
  const days = period === "7d" ? 7 : 30;
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return { gte: start.toISOString().slice(0, 10), lte };
}

export async function GET(request: NextRequest) {
  await requireAdminAuth();

  const { searchParams } = request.nextUrl;
  const workspace = searchParams.get("workspace") || undefined;
  const period = searchParams.get("period") || "30d";
  const sort = searchParams.get("sort") || "replyRate";
  const order = searchParams.get("order") || "desc";

  if (!["24h", "7d", "30d", "all"].includes(period)) {
    return NextResponse.json(
      { error: "Invalid period. Use 24h, 7d, 30d, or all." },
      { status: 400 }
    );
  }

  const sortField: SortableField = VALID_SORTS.has(sort)
    ? (sort as SortableField)
    : "replyRate";
  const sortOrder = order === "asc" ? "asc" : "desc";

  const dateRange = getDateRange(period);

  // Build where clause
  const where: Record<string, unknown> = {
    metricType: "campaign_snapshot",
  };
  if (workspace) where.workspace = workspace;
  if (dateRange.gte || dateRange.lte) {
    where.date = {};
    if (dateRange.gte) (where.date as Record<string, string>).gte = dateRange.gte;
    if (dateRange.lte) (where.date as Record<string, string>).lte = dateRange.lte;
  }

  const rows = await prisma.cachedMetrics.findMany({
    where,
    orderBy: { date: "desc" },
  });

  // Take the latest snapshot per campaign (metricKey)
  const latestPerCampaign = new Map<
    string,
    { workspace: string; data: CampaignSnapshot }
  >();
  for (const row of rows) {
    if (!latestPerCampaign.has(row.metricKey)) {
      try {
        const parsed = JSON.parse(row.data) as CampaignSnapshot;
        latestPerCampaign.set(row.metricKey, {
          workspace: row.workspace,
          data: parsed,
        });
      } catch {
        // Skip malformed rows
      }
    }
  }

  // Build response, filtering out campaigns with < 10 sends
  const campaigns: Array<Record<string, unknown>> = [];
  for (const [metricKey, { workspace: ws, data }] of latestPerCampaign) {
    const totalSent =
      (data.emailsSent || 0) +
      (data.linkedinConnectionsSent || 0) +
      (data.linkedinMessagesSent || 0);
    if (totalSent < 10) continue;

    campaigns.push({
      id: metricKey,
      name: data.campaignName,
      workspace: ws,
      channels: data.channels,
      sent: data.emailsSent || 0,
      replyRate: data.replyRate || 0,
      openRate: data.openRate || 0,
      bounceRate: data.bounceRate || 0,
      interestedRate: data.interestedRate || 0,
      replied: data.replied || 0,
      opened: data.opened || 0,
      bounced: data.bounced || 0,
      interested: data.interested || 0,
      copyStrategy: data.copyStrategy || null,
      status: data.status,
    });
  }

  // Sort
  campaigns.sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    if (typeof aVal === "string" && typeof bVal === "string") {
      return sortOrder === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }
    const aNum = (aVal as number) || 0;
    const bNum = (bVal as number) || 0;
    return sortOrder === "asc" ? aNum - bNum : bNum - aNum;
  });

  return NextResponse.json({
    campaigns,
    total: campaigns.length,
    period,
    filters: { workspace: workspace || null, sort: sortField, order: sortOrder },
  });
}
