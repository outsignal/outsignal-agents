import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET /api/invoice-settings — fetch global sender settings
export async function GET() {
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
  try {
    const body = await request.json();
    const { senderName, senderAddress, senderEmail, accountNumber, sortCode } =
      body;

    if (!senderName || typeof senderName !== "string") {
      return NextResponse.json(
        { error: "senderName is required" },
        { status: 400 },
      );
    }

    if (!senderEmail || typeof senderEmail !== "string") {
      return NextResponse.json(
        { error: "senderEmail is required" },
        { status: 400 },
      );
    }

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
