import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendOnboardingInviteEmail } from "@/lib/resend";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const invite = await prisma.onboardingInvite.findUnique({ where: { id } });
  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ invite });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const invite = await prisma.onboardingInvite.findUnique({ where: { id } });
  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  // Send or resend email
  if (body.sendEmail === true && invite.clientEmail) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const inviteUrl = `${appUrl}/o/${invite.token}`;

    await sendOnboardingInviteEmail({
      clientName: invite.clientName,
      clientEmail: invite.clientEmail,
      inviteUrl,
    });

    if (invite.status === "draft") {
      updateData.status = "sent";
    }
  }

  // Update editable fields
  if (body.clientName) updateData.clientName = body.clientName;
  if (body.clientEmail !== undefined) updateData.clientEmail = body.clientEmail;

  const updated = await prisma.onboardingInvite.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ invite: updated });
}
