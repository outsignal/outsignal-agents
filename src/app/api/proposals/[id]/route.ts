import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ proposal });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  // Mark as paid manually
  if (body.paidManually === true && proposal.status === "accepted") {
    updateData.status = "paid";
    updateData.paidAt = new Date();
    updateData.paidManually = true;
  }

  // Update editable fields
  if (body.clientName) updateData.clientName = body.clientName;
  if (body.clientEmail !== undefined) updateData.clientEmail = body.clientEmail;
  if (body.companyOverview) updateData.companyOverview = body.companyOverview;
  if (body.setupFee !== undefined) updateData.setupFee = body.setupFee;
  if (body.platformCost !== undefined)
    updateData.platformCost = body.platformCost;
  if (body.retainerCost !== undefined)
    updateData.retainerCost = body.retainerCost;

  // Allow sending (changing status from draft to sent)
  if (body.status === "sent" && proposal.status === "draft") {
    updateData.status = "sent";
  }

  const updated = await prisma.proposal.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ proposal: updated });
}
