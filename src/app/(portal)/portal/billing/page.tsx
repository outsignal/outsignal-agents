import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { formatGBP, formatInvoiceDate } from "@/lib/invoices/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { FileText } from "lucide-react";

export default async function PortalBillingPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  const invoices = await prisma.invoice.findMany({
    where: {
      workspaceSlug,
      status: { not: "draft" },
    },
    orderBy: { issueDate: "desc" },
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">Billing</h1>
        <p className="text-sm text-stone-500 mt-1">
          Your invoice history and payment records
        </p>
      </div>

      {/* Balance Summary */}
      {invoices.length > 0 && (() => {
        const unpaid = invoices.filter((inv) => inv.status !== "paid");
        const totalOutstanding = unpaid.reduce((sum, inv) => sum + inv.totalPence, 0);
        const overdueCount = invoices.filter((inv) => inv.status === "overdue").length;
        return (
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs uppercase tracking-wider text-stone-400 font-medium">Total Outstanding</p>
                  <p className="text-2xl font-mono font-semibold tabular-nums mt-1">
                    {formatGBP(totalOutstanding)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-stone-400 font-medium">Overdue Invoices</p>
                  <p className={`text-2xl font-mono font-semibold tabular-nums mt-1 ${overdueCount > 0 ? "text-red-600" : ""}`}>
                    {overdueCount}
                  </p>
                </div>
                <div className="flex items-end">
                  <p className="text-sm text-stone-500">
                    For payment inquiries, contact your Outsignal account manager.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Invoice Table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No invoices"
              description="Your invoices will appear here once they are issued."
              variant="compact"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-stone-50">
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id} className="hover:bg-stone-50 border-stone-100">
                    <TableCell className="font-medium font-mono">
                      {invoice.invoiceNumber}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-stone-500 tabular-nums">
                      {formatInvoiceDate(invoice.issueDate)}
                    </TableCell>
                    <TableCell className="text-sm font-mono text-stone-500 tabular-nums">
                      {formatInvoiceDate(invoice.dueDate)}
                    </TableCell>
                    <TableCell className="text-right font-medium font-mono tabular-nums">
                      {formatGBP(invoice.totalPence)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={invoice.status} type="invoice" />
                    </TableCell>
                    <TableCell>
                      {invoice.viewToken ? (
                        <a
                          href={`/api/invoices/${invoice.id}/pdf?token=${invoice.viewToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-[#635BFF] hover:text-[#4b44cc] hover:underline transition-colors"
                        >
                          Download PDF
                        </a>
                      ) : (
                        <span className="text-sm text-stone-500">\u2014</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
