"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import nextDynamic from "next/dynamic";
import { Plus, FileText } from "lucide-react";
import { useQueryState } from "nuqs";
import { PageShell } from "@/components/layout/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InvoiceTable } from "@/components/financials/invoice-table";
import { InvoiceForm } from "@/components/financials/invoice-form";
import type { InvoiceWithLineItems } from "@/lib/invoices/types";

// Lazy-load the other tab pages
const RevenueTab = nextDynamic(() => import("@/app/(admin)/revenue/page"), {
  loading: () => <TabSkeleton />,
});
const CostsTab = nextDynamic(
  () => import("@/app/(admin)/platform-costs/page"),
  { loading: () => <TabSkeleton /> }
);
const CashflowTab = nextDynamic(() => import("@/app/(admin)/cashflow/page"), {
  loading: () => <TabSkeleton />,
});

function TabSkeleton() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      <p className="text-sm text-muted-foreground mt-3">Loading...</p>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Workspace {
  slug: string;
  name: string;
  billingRetainerPence: number | null;
  billingPlatformFeePence: number | null;
  invoiceTaxRate: number | null;
}

const TAB_VALUES = ["invoices", "revenue", "costs", "cashflow"] as const;
type TabValue = (typeof TAB_VALUES)[number];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinancialsPage() {
  const [tab, setTab] = useQueryState("tab", {
    defaultValue: "invoices",
    parse: (v) => (TAB_VALUES.includes(v as TabValue) ? v : "invoices"),
    serialize: (v) => v,
  });

  // ── Invoices state (only fetched when needed) ──
  const [invoices, setInvoices] = useState<InvoiceWithLineItems[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterWorkspace, setFilterWorkspace] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterWorkspace !== "all")
        params.set("workspaceSlug", filterWorkspace);
      if (filterStatus !== "all") params.set("status", filterStatus);

      const res = await fetch(`/api/invoices?${params.toString()}`);
      const json = await res.json();
      setInvoices(json.invoices ?? []);
    } finally {
      setLoading(false);
    }
  }, [filterWorkspace, filterStatus]);

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/workspaces");
      const json = await res.json();
      setWorkspaces(
        (json.workspaces ?? []).map((ws: Record<string, unknown>) => ({
          slug: ws.slug,
          name: ws.name,
          billingRetainerPence: ws.billingRetainerPence ?? null,
          billingPlatformFeePence: ws.billingPlatformFeePence ?? null,
          invoiceTaxRate: ws.invoiceTaxRate ?? null,
        }))
      );
    } catch {
      // workspaces failing is non-fatal
    }
  }, []);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  // Only show "New Invoice" button on the invoices tab
  const actions =
    tab === "invoices" ? (
      <InvoiceForm
        workspaces={workspaces}
        onCreated={fetchInvoices}
        trigger={
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Invoice
          </Button>
        }
      />
    ) : undefined;

  return (
    <PageShell
      title="Financials"
      description="Invoices, revenue, costs, and cashflow"
      actions={actions}
      noPadding
    >
      <div className="px-6 pt-4">
        <Tabs
          value={tab}
          onValueChange={(v) => void setTab(v)}
        >
          <TabsList>
            <TabsTrigger value="invoices">Invoices</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="costs">Costs</TabsTrigger>
            <TabsTrigger value="cashflow">Cashflow</TabsTrigger>
          </TabsList>

          {/* Invoices tab — inline content */}
          <TabsContent value="invoices">
            <div className="py-4 space-y-4">
              {/* Filter bar */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  Workspace:
                </span>
                <Select
                  value={filterWorkspace}
                  onValueChange={setFilterWorkspace}
                >
                  <SelectTrigger
                    className="w-[180px]"
                    aria-label="Filter by workspace"
                  >
                    <SelectValue placeholder="All workspaces" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All workspaces</SelectItem>
                    {workspaces.map((ws) => (
                      <SelectItem key={ws.slug} value={ws.slug}>
                        {ws.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="text-xs text-muted-foreground">Status:</span>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger
                    className="w-[150px]"
                    aria-label="Filter by status"
                  >
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>

                {!loading && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    <span className="font-mono">{invoices.length}</span>{" "}
                    invoice{invoices.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Invoice table */}
              <div className="rounded-lg border border-border overflow-hidden">
                {loading ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <FileText
                      className="h-8 w-8 text-muted-foreground/30 mb-3 animate-pulse"
                      aria-hidden="true"
                    />
                    <p className="text-sm text-muted-foreground">
                      Loading invoices...
                    </p>
                  </div>
                ) : invoices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <FileText
                      className="h-8 w-8 text-muted-foreground/30 mb-3"
                      aria-hidden="true"
                    />
                    <p className="text-sm font-medium text-foreground">
                      No invoices found
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {filterWorkspace !== "all" || filterStatus !== "all"
                        ? "Try adjusting your filters"
                        : "Create your first invoice to get started"}
                    </p>
                  </div>
                ) : (
                  <InvoiceTable
                    invoices={invoices}
                    onRefresh={fetchInvoices}
                  />
                )}
              </div>
            </div>
          </TabsContent>

          {/* Revenue tab — lazy-loaded */}
          <TabsContent value="revenue">
            <RevenueTab />
          </TabsContent>

          {/* Costs tab — lazy-loaded */}
          <TabsContent value="costs">
            <CostsTab />
          </TabsContent>

          {/* Cashflow tab — lazy-loaded */}
          <TabsContent value="cashflow">
            <CashflowTab />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}
