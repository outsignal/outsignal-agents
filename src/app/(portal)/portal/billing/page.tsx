import { redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { prisma } from "@/lib/db";
import { formatGBP, formatInvoiceDate } from "@/lib/invoices/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Receipt } from "lucide-react";

const statusColors: Record<string, string> = {
  sent: "bg-blue-100 text-blue-800",
  paid: "bg-emerald-100 text-emerald-800",
  overdue: "bg-red-100 text-red-800",
};

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
        <h1 className="text-2xl font-heading font-bold">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">
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
                  <p className="text-sm text-muted-foreground">Total Outstanding</p>
                  <p className="text-2xl font-heading font-semibold tabular-nums mt-1">
                    {formatGBP(totalOutstanding)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Overdue Invoices</p>
                  <p className={`text-2xl font-heading font-semibold tabular-nums mt-1 ${overdueCount > 0 ? "text-red-600" : ""}`}>
                    {overdueCount}
                  </p>
                </div>
                <div className="flex items-end">
                  <p className="text-sm text-muted-foreground">
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
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Receipt className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No invoices yet</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Your invoices will appear here once they are issued.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
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
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      {invoice.invoiceNumber}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {formatInvoiceDate(invoice.issueDate)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground tabular-nums">
                      {formatInvoiceDate(invoice.dueDate)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatGBP(invoice.totalPence)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={`text-xs capitalize ${statusColors[invoice.status] ?? "bg-gray-100 text-gray-800"}`}
                      >
                        {invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {invoice.viewToken ? (
                        <a
                          href={`/api/invoices/${invoice.id}/pdf?token=${invoice.viewToken}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                        >
                          Download PDF
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
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
