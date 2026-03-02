import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (proposal.status !== "draft" && proposal.status !== "sent") {
    return NextResponse.json(
      { error: "Proposal has already been accepted" },
      { status: 400 },
    );
  }

  if (!body.signatureName || !body.signatureData) {
    return NextResponse.json(
      { error: "Signature name and data are required" },
      { status: 400 },
    );
  }

  await prisma.proposal.update({
    where: { id },
    data: {
      status: "accepted",
      signedAt: new Date(),
      signatureName: body.signatureName,
      signatureData: body.signatureData,
    },
  });

  notify({
    type: "proposal",
    severity: "info",
    title: `Proposal accepted: ${proposal.clientName || proposal.id}`,
    metadata: { proposalId: proposal.id },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
