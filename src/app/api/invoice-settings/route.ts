import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { invoiceSettingsSchema } from "@/lib/validations/invoices";

// GET /api/invoice-settings — fetch global sender settings
export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await prisma.invoiceSenderSettings.findFirst();
    return NextResponse.json({ settings: settings ?? null });
  } catch (err) {
    console.error("[GET /api/invoice-settings] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch invoice settings" },
      { status: 500 },
    );
  }
}

// PUT /api/invoice-settings — upsert global sender settings
export async function PUT(request: Request) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const result = invoiceSettingsSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }
    const { senderName, senderAddress, senderEmail, accountNumber, sortCode } =
      result.data;

    // Fetch existing record to determine upsert behavior
    const existing = await prisma.invoiceSenderSettings.findFirst();

    let settings;
    if (existing) {
      settings = await prisma.invoiceSenderSettings.update({
        where: { id: existing.id },
        data: {
          senderName,
          senderAddress: senderAddress ?? null,
          senderEmail,
          accountNumber: accountNumber ?? null,
          sortCode: sortCode ?? null,
        },
      });
    } else {
      settings = await prisma.invoiceSenderSettings.create({
        data: {
          senderName,
          senderAddress: senderAddress ?? null,
          senderEmail,
          accountNumber: accountNumber ?? null,
          sortCode: sortCode ?? null,
        },
      });
    }

    return NextResponse.json({ settings });
  } catch (err) {
    console.error("[PUT /api/invoice-settings] Error:", err);
    return NextResponse.json(
      { error: "Failed to save invoice settings" },
      { status: 500 },
    );
  }
}
