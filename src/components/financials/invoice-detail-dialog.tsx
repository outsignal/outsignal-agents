"use client";

import { useState, useEffect } from "react";
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
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    if (!open || !invoice) {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
      return;
    }

    let revoked = false;
    let blobUrl: string | null = null;

    setPdfLoading(true);
    fetch(`/api/invoices/${invoice.id}/pdf`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load PDF");
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        blobUrl = URL.createObjectURL(blob);
        setPdfUrl(blobUrl);
      })
      .catch(() => {
        if (!revoked) setPdfUrl(null);
      })
      .finally(() => {
        if (!revoked) setPdfLoading(false);
      });

    return () => {
      revoked = true;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      setPdfUrl(null);
      setPdfLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice?.id]);

  if (!invoice) return null;

  const canSend = invoice.status === "draft" || invoice.status === "overdue";
  const canMarkPaid = invoice.status === "sent" || invoice.status === "overdue";

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
      <DialogContent className="sm:max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-4 pb-3 border-b border-zinc-200 shrink-0">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-lg font-semibold">
              {invoice.invoiceNumber}
            </DialogTitle>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
          <DialogDescription className="sr-only">
            Invoice {invoice.invoiceNumber} details
          </DialogDescription>
        </DialogHeader>

        {/* Embedded PDF */}
        <div className="flex-1 min-h-0 bg-zinc-100">
          {pdfLoading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-zinc-500">Loading PDF...</p>
            </div>
          ) : pdfUrl ? (
            <iframe
              src={pdfUrl}
              className="w-full h-full border-0"
              title={`Invoice ${invoice.invoiceNumber}`}
            />
          ) : null}
        </div>

        {/* Action buttons */}
        <DialogFooter className="px-6 py-3 border-t border-zinc-200 shrink-0 gap-2 sm:gap-2">
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
