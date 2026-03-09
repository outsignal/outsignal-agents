"use client";

import { useState } from "react";
import { FileDown, Send, CheckCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { formatGBP, formatInvoiceDate } from "@/lib/invoices/format";
import type { InvoiceWithLineItems } from "@/lib/invoices/types";
import { toast } from "sonner";

interface InvoiceDetailDialogProps {
  invoice: InvoiceWithLineItems | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
}

export function InvoiceDetailDialog({
  invoice,
  open,
  onOpenChange,
  onRefresh,
}: InvoiceDetailDialogProps) {
  const [loading, setLoading] = useState(false);

  if (!invoice) return null;

  const canSend = invoice.status === "draft" || invoice.status === "overdue";
  const canMarkPaid = invoice.status === "sent" || invoice.status === "overdue";

  const senderLines = [
    invoice.senderName,
    ...(invoice.senderAddress ? invoice.senderAddress.split("\n") : []),
    invoice.senderEmail,
  ].filter(Boolean);

  const clientLines = [
    invoice.clientCompanyName,
    ...(invoice.clientAddress ? invoice.clientAddress.split("\n") : []),
  ].filter(Boolean);

  const bankDetailsLines = invoice.bankDetails
    ? invoice.bankDetails.split("\n")
    : [];

  async function handleSend() {
    if (!invoice) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send`, {
        method: "POST",
      });
      if (res.ok) {
        toast.success("Invoice sent");
        onRefresh();
      } else {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to send" }));
        toast.error(err.error ?? "Failed to send invoice");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkPaid() {
    if (!invoice) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" }),
      });
      if (res.ok) {
        toast.success("Invoice marked as paid");
        onRefresh();
      } else {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to update" }));
        toast.error(err.error ?? "Failed to mark invoice as paid");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <DialogHeader>
          <div className="flex items-center gap-3">
            <DialogTitle className="text-2xl font-bold tracking-tight">
              INVOICE
            </DialogTitle>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
          <DialogDescription className="sr-only">
            Invoice {invoice.invoiceNumber} details
          </DialogDescription>
        </DialogHeader>

        {/* From / Bill To blocks */}
        <div className="grid grid-cols-2 gap-8 mt-2">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              From
            </p>
            {senderLines.map((line, i) => (
              <p key={i} className="text-sm leading-relaxed text-foreground">
                {line}
              </p>
            ))}
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Bill To
            </p>
            {clientLines.map((line, i) => (
              <p key={i} className="text-sm leading-relaxed text-foreground">
                {line}
              </p>
            ))}
          </div>
        </div>

        {/* Metadata bar */}
        <div className="grid grid-cols-4 gap-4 bg-muted/50 rounded-md p-3 mt-4">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
              Invoice #
            </p>
            <p className="text-sm font-semibold text-foreground font-mono">
              {invoice.invoiceNumber}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
              Date
            </p>
            <p className="text-sm font-semibold text-foreground">
              {formatInvoiceDate(new Date(invoice.issueDate))}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
              Due Date
            </p>
            <p className="text-sm font-semibold text-foreground">
              {formatInvoiceDate(new Date(invoice.dueDate))}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
              Amount Due
            </p>
            <p className="text-sm font-semibold text-foreground">
              {formatGBP(invoice.totalPence)}
            </p>
          </div>
        </div>

        {/* Line items table */}
        <div className="mt-4">
          {/* Table header */}
          <div className="grid grid-cols-[3fr_1fr_1.5fr_1.5fr] bg-zinc-900 text-white rounded-[3px] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit Price</span>
            <span className="text-right">Amount</span>
          </div>
          {/* Table rows */}
          {invoice.lineItems.map((item, index) => (
            <div
              key={item.id}
              className={`grid grid-cols-[3fr_1fr_1.5fr_1.5fr] px-3 py-2 border-b border-border text-sm ${
                index % 2 !== 0 ? "bg-muted/30" : ""
              }`}
            >
              <span className="text-foreground">{item.description}</span>
              <span className="text-right text-foreground tabular-nums">
                {item.quantity}
              </span>
              <span className="text-right text-foreground tabular-nums">
                {formatGBP(item.unitPricePence)}
              </span>
              <span className="text-right text-foreground tabular-nums">
                {formatGBP(item.amountPence)}
              </span>
            </div>
          ))}
        </div>

        {/* Totals section */}
        <div className="flex justify-end mt-4">
          <div className="w-60">
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted-foreground">Subtotal</span>
              <span className="text-sm text-foreground tabular-nums">
                {formatGBP(invoice.subtotalPence)}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border">
              <span className="text-sm text-muted-foreground">
                Tax ({invoice.taxRate}%)
              </span>
              <span className="text-sm text-foreground tabular-nums">
                {formatGBP(invoice.taxAmountPence)}
              </span>
            </div>
            <div className="flex justify-between items-center bg-zinc-900 rounded-[3px] px-2 py-2 mt-1">
              <span className="text-sm font-semibold text-white">Total</span>
              <span
                className="text-sm font-semibold tabular-nums"
                style={{ color: "#F0FF7A" }}
              >
                {formatGBP(invoice.totalPence)}
              </span>
            </div>
          </div>
        </div>

        {/* Bank details / notes */}
        {bankDetailsLines.length > 0 && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              Notes
            </p>
            {bankDetailsLines.map((line, i) => (
              <p key={i} className="text-[13px] text-muted-foreground leading-relaxed">
                {line}
              </p>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <DialogFooter className="mt-4 gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              window.open(`/api/invoices/${invoice.id}/pdf`, "_blank")
            }
            disabled={loading}
          >
            <FileDown className="h-4 w-4 mr-1.5" />
            Download PDF
          </Button>

          {canSend && (
            <Button
              variant="outline"
              size="sm"
              className="text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              onClick={handleSend}
              disabled={loading}
            >
              <Send className="h-4 w-4 mr-1.5" />
              Send
            </Button>
          )}

          {canMarkPaid && (
            <Button
              variant="outline"
              size="sm"
              className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
              onClick={handleMarkPaid}
              disabled={loading}
            >
              <CheckCircle className="h-4 w-4 mr-1.5" />
              Mark Paid
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
