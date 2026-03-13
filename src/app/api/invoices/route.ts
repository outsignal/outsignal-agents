import { NextResponse } from "next/server";
import { createInvoice, listInvoices } from "@/lib/invoices/operations";
import { parseJsonBody } from "@/lib/parse-json";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { createInvoiceSchema } from "@/lib/validations/invoices";

// GET /api/invoices?workspaceSlug=slug&status=draft — list invoices
export async function GET(request: Request) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;
    const result = createInvoiceSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }
    const {
      workspaceSlug,
      lineItems,
      billingPeriodStart,
      billingPeriodEnd,
      issueDate,
    } = result.data;

    const invoice = await createInvoice({
      workspaceSlug,
      lineItems: lineItems as { description: string; quantity: number; unitPricePence: number }[],
      billingPeriodStart: billingPeriodStart ? new Date(billingPeriodStart) : undefined,
      billingPeriodEnd: billingPeriodEnd ? new Date(billingPeriodEnd) : undefined,
      issueDate: issueDate ? new Date(issueDate) : undefined,
    });

    return NextResponse.json({ invoice }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/invoices] Error:", err);
    return NextResponse.json({ error: "Failed to create invoice" }, { status: 500 });
  }
}
