"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { TrendingUp } from "lucide-react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RevenueChart } from "@/components/financials/revenue-chart";
import { ErrorBanner } from "@/components/ui/error-banner";
import { formatGBP } from "@/lib/invoices/format";
import type { RevenueResponse } from "@/app/api/revenue/route";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RevenuePage() {
  const [data, setData] = useState<RevenueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRevenue() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/revenue?months=12");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as RevenueResponse;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load revenue data");
      } finally {
        setLoading(false);
      }
    }
    void fetchRevenue();
  }, []);

  // Derived: average invoice for per-client table
  function avgInvoice(totalPaidPence: number, count: number): string {
    if (count === 0) return formatGBP(0);
    return formatGBP(Math.round(totalPaidPence / count));
  }

  return (
    <div>
      <Header
        title="Revenue"
        description="Financial performance overview across all clients"
      />

      <div className="p-6 space-y-6">
        {/* Error banner */}
        {error && !loading && (
          <ErrorBanner message={`Failed to load revenue data: ${error}`} />
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[88px] rounded-lg" />
            ))
          ) : (
            <>
              <MetricCard
                label="Total Revenue"
                value={data ? formatGBP(data.totalRevenuePence) : "£0.00"}
                trend={data && data.totalRevenuePence > 0 ? "up" : "neutral"}
                detail="All-time paid invoices"
                density="compact"
              />
              <MetricCard
                label="Outstanding"
                value={data ? formatGBP(data.outstandingPence) : "£0.00"}
                trend={data && data.outstandingPence > 0 ? "warning" : "neutral"}
                detail="Sent + unpaid invoices"
                density="compact"
              />
              <MetricCard
                label="MRR"
                value={data ? formatGBP(data.mrrPence) : "£0.00"}
                trend={data && data.mrrPence > 0 ? "up" : "neutral"}
                detail="3-month average"
                density="compact"
              />
              <MetricCard
                label="Overdue"
                value={data ? formatGBP(data.overduePence) : "£0.00"}
                trend={data && data.overduePence > 0 ? "down" : "neutral"}
                detail={data && data.overduePence > 0 ? "Needs attention" : "All clear"}
                density="compact"
              />
            </>
          )}
        </div>

        {/* Revenue Chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle>Monthly Revenue</CardTitle>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="inline-block w-3 h-0.5 rounded-full"
                  style={{ backgroundColor: "oklch(0.75 0.18 110)" }}
                />
                Paid invoices
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : error ? (
              <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                {error}
              </div>
            ) : !data || data.timeSeries.every((p) => p.revenuePence === 0) ? (
              <div className="h-[240px] flex flex-col items-center justify-center text-sm text-muted-foreground gap-2">
                <TrendingUp className="h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
                <p>No paid invoices yet</p>
              </div>
            ) : (
              <RevenueChart data={data.timeSeries} />
            )}
          </CardContent>
        </Card>

        {/* Per-client breakdown table */}
        <Card>
          <CardHeader>
            <CardTitle>Per-Client Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !data || data.clientBreakdown.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  No paid invoices to show yet.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Total Paid</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Avg Invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.clientBreakdown.map((row) => (
                    <TableRow key={row.workspaceSlug} className="border-border">
                      <TableCell>
                        <div>
                          <p className="text-sm font-medium">{row.workspaceName}</p>
                          <p className="text-xs text-muted-foreground">{row.workspaceSlug}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-sm">
                        {formatGBP(row.totalPaidPence)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                        {row.invoiceCount}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                        {avgInvoice(row.totalPaidPence, row.invoiceCount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
