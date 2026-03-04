import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getInvoice, updateInvoiceStatus } from "@/lib/invoices/operations";
import { sendInvoiceEmail } from "@/lib/invoices/email";

// POST /api/invoices/[id]/send — email invoice to workspace billing contact
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
      select: { billingClientEmail: true },
    });

    const recipientEmail = workspace?.billingClientEmail;
    if (!recipientEmail) {
      return NextResponse.json(
        { error: "No billing email configured for this workspace" },
        { status: 400 },
      );
    }

    // Send email with PDF attachment
    await sendInvoiceEmail(invoice, recipientEmail);

    // Update invoice status to "sent" (also sets sentAt timestamp)
    await updateInvoiceStatus(id, "sent");

    return NextResponse.json({ sent: true, to: recipientEmail });
  } catch (err) {
    console.error("[POST /api/invoices/[id]/send] Error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to send invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
