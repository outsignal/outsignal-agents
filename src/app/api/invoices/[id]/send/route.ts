import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getInvoice, updateInvoiceStatus } from "@/lib/invoices/operations";
import { sendInvoiceEmail } from "@/lib/invoices/email";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { auditLog } from "@/lib/audit";

// POST /api/invoices/[id]/send — email invoice to workspace billing contact
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Fetch invoice
    const invoice = await getInvoice(id);
    if (!invoice) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fetch workspace to get billing email
    const workspace = await prisma.workspace.findUnique({
      where: { slug: invoice.workspaceSlug },
      select: { billingClientEmail: true, billingCcEmails: true },
    });

    const recipientEmail = workspace?.billingClientEmail;
    if (!recipientEmail) {
      return NextResponse.json(
        { error: "No billing email configured for this workspace" },
        { status: 400 },
      );
    }

    // Send email with PDF attachment
    const ccEmails = workspace?.billingCcEmails
      ? workspace.billingCcEmails.split(",").map((e: string) => e.trim()).filter(Boolean)
      : [];
    const delivery = await sendInvoiceEmail(invoice, recipientEmail, ccEmails);
    if (!delivery.delivered) {
      return NextResponse.json(
        { error: "Invoice email delivery is not configured" },
        { status: 503 },
      );
    }

    // Update invoice status to "sent" (also sets sentAt timestamp)
    await updateInvoiceStatus(id, "sent");

    auditLog({
      action: "invoice.send",
      entityType: "Invoice",
      entityId: id,
      adminEmail: session.email,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        workspaceSlug: invoice.workspaceSlug,
        recipientEmail,
        ccEmails,
        providerId: delivery.providerId ?? null,
      },
    });

    return NextResponse.json({ sent: true, to: recipientEmail, cc: ccEmails });
  } catch (err) {
    console.error("[POST /api/invoices/[id]/send] Error:", err);
    return NextResponse.json({ error: "Failed to send invoice" }, { status: 500 });
  }
}
