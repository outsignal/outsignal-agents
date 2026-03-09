"use client";

import { useState } from "react";
import { FileDown, Send, CheckCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { InvoiceDetailDialog } from "./invoice-detail-dialog";
import { formatGBP, formatInvoiceDate } from "@/lib/invoices/format";
import type { InvoiceWithLineItems } from "@/lib/invoices/types";
import { toast } from "sonner";

interface InvoiceTableProps {
  invoices: InvoiceWithLineItems[];
  onRefresh: () => void;
}

export function InvoiceTable({ invoices, onRefresh }: InvoiceTableProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceWithLineItems | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  async function handleSend(id: string) {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/invoices/${id}/send`, { method: "POST" });
      if (res.ok) {
        onRefresh();
        toast.success("Invoice sent");
      } else {
        const err = await res.json().catch(() => ({ error: "Failed to send" }));
        toast.error(err.error ?? "Failed to send invoice");
      }
    } finally {
      setLoadingId(null);
    }
  }

  async function handleMarkPaid(id: string) {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" }),
      });
      if (res.ok) {
        onRefresh();
        toast.success("Invoice marked as paid");
      } else {
        const err = await res.json().catch(() => ({ error: "Failed to update" }));
        toast.error(err.error ?? "Failed to mark invoice as paid");
      }
    } finally {
      setLoadingId(null);
    }
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileText className="h-10 w-10 text-muted-foreground/30 mb-3" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Create your first invoice using the &quot;New Invoice&quot; button above.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Invoice #</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Issue Date</TableHead>
          <TableHead>Due Date</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => {
          const isLoading = loadingId === invoice.id;
          const canSend = invoice.status === "draft" || invoice.status === "overdue";
          const canMarkPaid = invoice.status === "sent" || invoice.status === "overdue";

          return (
            <TableRow
              key={invoice.id}
              className="border-border cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => {
                setSelectedInvoice(invoice);
                setDetailOpen(true);
              }}
            >
              <TableCell className="font-mono text-sm font-medium">
                {invoice.invoiceNumber}
              </TableCell>
              <TableCell className="text-sm">{invoice.clientCompanyName}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatInvoiceDate(new Date(invoice.issueDate))}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatInvoiceDate(new Date(invoice.dueDate))}
              </TableCell>
              <TableCell className="text-right font-medium text-sm tabular-nums">
                {formatGBP(invoice.totalPence)}
              </TableCell>
              <TableCell>
                <InvoiceStatusBadge status={invoice.status} />
              </TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {/* PDF download — always available */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      window.open(`/api/invoices/${invoice.id}/pdf`, "_blank")
                    }
                    title="Download PDF"
                    disabled={isLoading}
                  >
                    <FileDown className="h-3.5 w-3.5" />
                    <span className="sr-only">PDF</span>
                  </Button>

                  {/* Send — only for draft/overdue */}
                  {canSend && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700"
                      onClick={() => handleSend(invoice.id)}
                      disabled={isLoading}
                      title="Send invoice by email"
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      Send
                    </Button>
                  )}

                  {/* Mark Paid — only for sent/overdue */}
                  {canMarkPaid && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-emerald-600 hover:text-emerald-700"
                      onClick={() => handleMarkPaid(invoice.id)}
                      disabled={isLoading}
                      title="Mark as paid"
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                      Paid
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>

      <InvoiceDetailDialog
        invoice={selectedInvoice}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onRefresh={onRefresh}
      />
    </Table>
  );
}
