import { getInvoice, getInvoiceByToken } from "@/lib/invoices/operations";
import { InvoicePdfDocument } from "@/lib/invoices/pdf";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";

// GET /api/invoices/[id]/pdf — render and return invoice as PDF
// Accepts optional ?token=xxx for portal/token-based access
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token")?.trim();

    const invoice = token
      ? await getInvoiceByToken(token)
      : await getInvoice(id);

    if (!invoice) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Cast needed: renderToBuffer expects ReactElement<DocumentProps> but our
    // wrapper component has InvoicePdfDocumentProps. The Document is rendered internally.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(
      React.createElement(InvoicePdfDocument, { invoice }) as any,
    );

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
      },
    });
  } catch (err) {
    console.error("[GET /api/invoices/[id]/pdf] Error:", err);
    return new Response(JSON.stringify({ error: "Failed to generate PDF" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
