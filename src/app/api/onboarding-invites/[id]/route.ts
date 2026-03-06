import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendOnboardingInviteEmail } from "@/lib/resend";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { updateOnboardingInviteSchema } from "@/lib/validations/onboarding";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const parseResult = updateOnboardingInviteSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors }, { status: 400 });
  }
  const validated = parseResult.data;

  const invite = await prisma.onboardingInvite.findUnique({ where: { id } });
  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  // Send or resend email
  if (validated.sendEmail === true && invite.clientEmail) {
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
  if (validated.clientName) updateData.clientName = validated.clientName;
  if (validated.clientEmail !== undefined) updateData.clientEmail = validated.clientEmail;
  if (validated.status !== undefined && !validated.sendEmail) updateData.status = validated.status;
  if (validated.createWorkspace !== undefined) updateData.createWorkspace = validated.createWorkspace;
  if (validated.workspaceSlug !== undefined) updateData.workspaceSlug = validated.workspaceSlug;

  const updated = await prisma.onboardingInvite.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ invite: updated });
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

  const invite = await prisma.onboardingInvite.findUnique({ where: { id } });
  if (!invite) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (invite.status === "completed") {
    return NextResponse.json(
      { error: "Cannot delete completed onboarding invite" },
      { status: 409 },
    );
  }

  await prisma.onboardingInvite.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
