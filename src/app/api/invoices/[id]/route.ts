import { NextResponse } from "next/server";
import {
  getInvoice,
  getInvoiceByToken,
  updateInvoiceStatus,
} from "@/lib/invoices/operations";
import { InvoiceStatus } from "@/lib/invoices/types";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { updateInvoiceStatusSchema } from "@/lib/validations/invoices";

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

    let invoice;
    if (token) {
      // Portal/public access via viewToken — no session required
      invoice = await getInvoiceByToken(token);
    } else {
      // No token — require admin session
      const session = await requireAdminAuth();
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      invoice = await getInvoice(id);
    }

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
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const result = updateInvoiceStatusSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }

    const invoice = await updateInvoiceStatus(id, result.data.status as InvoiceStatus);

    return NextResponse.json({ invoice });
  } catch (err) {
    console.error("[PATCH /api/invoices/[id]] Error:", err);

    // Status transition errors are client errors (400) — intentional business message
    if (
      err instanceof Error &&
      err.message.includes("Invalid status transition")
    ) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    return NextResponse.json({ error: "Failed to update invoice" }, { status: 500 });
  }
}
