import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { parseJsonBody } from "@/lib/parse-json";
import { acceptProposalSchema } from "@/lib/validations/proposals";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await parseJsonBody(request);
  if (body instanceof Response) return body;
  const result = acceptProposalSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
  }

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

  await prisma.proposal.update({
    where: { id },
    data: {
      status: "accepted",
      signedAt: new Date(),
      signatureName: result.data.signatureName,
      signatureData: result.data.signatureData,
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
