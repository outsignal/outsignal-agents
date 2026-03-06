import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { updateProposalSchema } from "@/lib/validations/proposals";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parseResult = updateProposalSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors }, { status: 400 });
  }
  const validated = parseResult.data;

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  // Mark as paid manually
  if (validated.paidManually === true && proposal.status === "accepted") {
    updateData.status = "paid";
    updateData.paidAt = new Date();
    updateData.paidManually = true;
  }

  // Update editable fields
  if (validated.clientName) updateData.clientName = validated.clientName;
  if (validated.clientEmail !== undefined) updateData.clientEmail = validated.clientEmail;
  if (validated.companyOverview) updateData.companyOverview = validated.companyOverview;
  if (validated.setupFee !== undefined) updateData.setupFee = validated.setupFee;
  if (validated.platformCost !== undefined)
    updateData.platformCost = validated.platformCost;
  if (validated.retainerCost !== undefined)
    updateData.retainerCost = validated.retainerCost;

  // Package type update
  if (validated.packageType !== undefined) updateData.packageType = validated.packageType;

  // Allow sending (changing status from draft to sent)
  if (validated.status === "sent" && proposal.status === "draft") {
    updateData.status = "sent";
  }

  // General status override for admin
  if (
    validated.status !== undefined &&
    validated.status !== "sent" &&
    validated.status !== proposal.status
  ) {
    updateData.status = validated.status;
  }

  const updated = await prisma.proposal.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ proposal: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (proposal.status !== "draft") {
    return NextResponse.json(
      { error: "Cannot delete a non-draft proposal" },
      { status: 409 },
    );
  }

  await prisma.proposal.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
