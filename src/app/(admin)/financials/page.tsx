"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import { Plus, FileText } from "lucide-react";
import { Header } from "@/components/layout/header";
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Workspace {
  slug: string;
  name: string;
  billingRetainerPence: number | null;
  billingPlatformFeePence: number | null;
  invoiceTaxRate: number | null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinancialsPage() {
  const [invoices, setInvoices] = useState<InvoiceWithLineItems[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [filterWorkspace, setFilterWorkspace] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterWorkspace !== "all") params.set("workspaceSlug", filterWorkspace);
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
      // workspaces failing is non-fatal — form will show empty workspace list
    }
  }, []);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  return (
    <div>
      <Header
        title="Invoices"
        description="Manage client invoices and billing"
        actions={
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
        }
      />

      <div className="p-6 space-y-4">
        {/* Filter bar */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-stone-500">Workspace:</span>
          <Select value={filterWorkspace} onValueChange={setFilterWorkspace}>
            <SelectTrigger className="w-[180px]" aria-label="Filter by workspace">
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

          <span className="text-xs text-stone-500">Status:</span>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[150px]" aria-label="Filter by status">
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
            <span className="text-xs text-stone-500 ml-auto">
              <span className="font-mono">{invoices.length}</span> invoice{invoices.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Invoice table */}
        <div className="rounded-lg border border-stone-200 overflow-hidden">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="h-8 w-8 text-stone-300 mb-3 animate-pulse" aria-hidden="true" />
              <p className="text-sm text-stone-500">Loading invoices...</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <FileText className="h-8 w-8 text-stone-300 mb-3" aria-hidden="true" />
              <p className="text-sm font-medium text-stone-900">No invoices found</p>
              <p className="text-sm text-stone-500 mt-1">
                {filterWorkspace !== "all" || filterStatus !== "all"
                  ? "Try adjusting your filters"
                  : "Create your first invoice to get started"}
              </p>
            </div>
          ) : (
            <InvoiceTable invoices={invoices} onRefresh={fetchInvoices} />
          )}
        </div>
      </div>
    </div>
  );
}
