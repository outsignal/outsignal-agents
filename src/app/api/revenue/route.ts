import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export interface RevenueMonthPoint {
  month: string; // "YYYY-MM"
  revenuePence: number;
}

export interface RevenueClientBreakdown {
  workspaceSlug: string;
  workspaceName: string;
  totalPaidPence: number;
  invoiceCount: number;
}

export interface RevenueResponse {
  totalRevenuePence: number;
  outstandingPence: number;
  overduePence: number;
  mrrPence: number;
  timeSeries: RevenueMonthPoint[];
  clientBreakdown: RevenueClientBreakdown[];
}

// GET /api/revenue?months=12 — revenue summary for admin dashboard
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const months = Math.max(1, Math.min(24, parseInt(searchParams.get("months") ?? "12") || 12));

    // ── KPI aggregates ──────────────────────────────────────────────────────

    // Total Revenue: sum of paid invoices
    const totalRevResult = await prisma.invoice.aggregate({
      _sum: { totalPence: true },
      where: { status: "paid" },
    });
    const totalRevenuePence = totalRevResult._sum.totalPence ?? 0;

    // Outstanding: sum of sent + overdue
    const outstandingResult = await prisma.invoice.aggregate({
      _sum: { totalPence: true },
      where: { status: { in: ["sent", "overdue"] } },
    });
    const outstandingPence = outstandingResult._sum.totalPence ?? 0;

    // Overdue: sum of overdue only
    const overdueResult = await prisma.invoice.aggregate({
      _sum: { totalPence: true },
      where: { status: "overdue" },
    });
    const overduePence = overdueResult._sum.totalPence ?? 0;

    // MRR: average monthly revenue from paid invoices in the last 3 months
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const recentPaidResult = await prisma.invoice.aggregate({
      _sum: { totalPence: true },
      where: {
        status: "paid",
        paidAt: { gte: threeMonthsAgo },
      },
    });
    const recentPaidTotal = recentPaidResult._sum.totalPence ?? 0;
    const mrrPence = Math.round(recentPaidTotal / 3);

    // ── Monthly time series ─────────────────────────────────────────────────

    // Build the last N months list (YYYY-MM strings)
    const monthLabels: string[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      monthLabels.push(`${d.getFullYear()}-${mm}`);
    }

    // Fetch all paid invoices in the time window
    const windowStart = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    const paidInvoices = await prisma.invoice.findMany({
      where: {
        status: "paid",
        paidAt: { gte: windowStart },
      },
      select: { paidAt: true, totalPence: true },
    });

    // Group by month
    const monthMap: Record<string, number> = {};
    for (const inv of paidInvoices) {
      if (!inv.paidAt) continue;
      const d = inv.paidAt;
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const key = `${d.getFullYear()}-${mm}`;
      monthMap[key] = (monthMap[key] ?? 0) + inv.totalPence;
    }

    const timeSeries: RevenueMonthPoint[] = monthLabels.map((month) => ({
      month,
      revenuePence: monthMap[month] ?? 0,
    }));

    // ── Per-client breakdown ────────────────────────────────────────────────

    // Get workspaces map for names
    const workspaces = await prisma.workspace.findMany({
      select: { slug: true, name: true },
    });
    const workspaceNames = new Map(workspaces.map((w) => [w.slug, w.name]));

    // Group paid invoices by workspace
    const paidByWorkspace = await prisma.invoice.groupBy({
      by: ["workspaceSlug"],
      where: { status: "paid" },
      _sum: { totalPence: true },
      _count: { id: true },
      orderBy: { _sum: { totalPence: "desc" } },
    });

    const clientBreakdown: RevenueClientBreakdown[] = paidByWorkspace.map((row) => ({
      workspaceSlug: row.workspaceSlug,
      workspaceName: workspaceNames.get(row.workspaceSlug) ?? row.workspaceSlug,
      totalPaidPence: row._sum.totalPence ?? 0,
      invoiceCount: row._count.id,
    }));

    const response: RevenueResponse = {
      totalRevenuePence,
      outstandingPence,
      overduePence,
      mrrPence,
      timeSeries,
      clientBreakdown,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[GET /api/revenue] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch revenue data" },
      { status: 500 },
    );
  }
}
