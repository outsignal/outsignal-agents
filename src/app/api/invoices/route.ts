import { NextResponse } from "next/server";
import { createInvoice, listInvoices } from "@/lib/invoices/operations";

// GET /api/invoices?workspaceSlug=slug&status=draft — list invoices
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspaceSlug")?.trim() || undefined;
    const status = searchParams.get("status")?.trim() || undefined;

    const invoices = await listInvoices({ workspaceSlug, status });

    return NextResponse.json({ invoices });
  } catch (err) {
    console.error("[GET /api/invoices] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch invoices" },
      { status: 500 },
    );
  }
}

// POST /api/invoices — create a new invoice
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      workspaceSlug,
      lineItems,
      billingPeriodStart,
      billingPeriodEnd,
      issueDate,
    } = body;

    if (!workspaceSlug || typeof workspaceSlug !== "string") {
      return NextResponse.json(
        { error: "workspaceSlug is required" },
        { status: 400 },
      );
    }

    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return NextResponse.json(
        { error: "lineItems must be a non-empty array" },
        { status: 400 },
      );
    }

    const invoice = await createInvoice({
      workspaceSlug,
      lineItems,
      billingPeriodStart: billingPeriodStart ? new Date(billingPeriodStart) : undefined,
      billingPeriodEnd: billingPeriodEnd ? new Date(billingPeriodEnd) : undefined,
      issueDate: issueDate ? new Date(issueDate) : undefined,
    });

    return NextResponse.json({ invoice }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/invoices] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to create invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
