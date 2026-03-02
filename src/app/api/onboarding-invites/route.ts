import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateProposalToken } from "@/lib/tokens";
import { sendOnboardingInviteEmail } from "@/lib/resend";
import { notify } from "@/lib/notify";

export async function GET() {
  const invites = await prisma.onboardingInvite.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ invites });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { clientName, clientEmail, proposalId, createWorkspace } = body;

    if (!clientName) {
      return NextResponse.json(
        { error: "clientName is required" },
        { status: 400 },
      );
    }

    const token = generateProposalToken();

    const invite = await prisma.onboardingInvite.create({
      data: {
        token,
        clientName,
        clientEmail: clientEmail || null,
        proposalId: proposalId || null,
        createWorkspace: createWorkspace !== false,
        status: "draft",
      },
    });

    notify({
      type: "onboard",
      severity: "info",
      title: `Onboarding invite created: ${clientName}`,
      metadata: { inviteId: invite.id },
    }).catch(() => {});

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const inviteUrl = `${appUrl}/o/${token}`;

    // If client email provided, send the invite and mark as sent
    if (clientEmail) {
      try {
        await sendOnboardingInviteEmail({
          clientName,
          clientEmail,
          inviteUrl,
        });
        await prisma.onboardingInvite.update({
          where: { id: invite.id },
          data: { status: "sent" },
        });
      } catch {
        // Email failed — leave as draft
      }
    }

    return NextResponse.json({
      id: invite.id,
      token: invite.token,
      url: inviteUrl,
    });
  } catch (error) {
    console.error("Failed to create onboarding invite:", error);
    return NextResponse.json(
      { error: "Failed to create onboarding invite" },
      { status: 500 },
    );
  }
}
