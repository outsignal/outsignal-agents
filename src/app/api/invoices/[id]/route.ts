import { NextResponse } from "next/server";
import {
  getInvoice,
  getInvoiceByToken,
  updateInvoiceStatus,
} from "@/lib/invoices/operations";
import { InvoiceStatus } from "@/lib/invoices/types";

// GET /api/invoices/[id] — fetch single invoice
// Also accepts ?token=xxx for portal token-based access
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
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ invoice });
  } catch (err) {
    console.error("[GET /api/invoices/[id]] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch invoice" },
      { status: 500 },
    );
  }
}

// PATCH /api/invoices/[id] — update invoice status
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || typeof status !== "string") {
      return NextResponse.json(
        { error: "status is required" },
        { status: 400 },
      );
    }

    const validStatuses = ["draft", "sent", "paid", "overdue"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status: ${status}. Must be one of: ${validStatuses.join(", ")}` },
        { status: 400 },
      );
    }

    const invoice = await updateInvoiceStatus(id, status as InvoiceStatus);

    return NextResponse.json({ invoice });
  } catch (err) {
    console.error("[PATCH /api/invoices/[id]] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to update invoice";

    // Status transition errors are client errors (400)
    if (
      err instanceof Error &&
      err.message.includes("Invalid status transition")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
