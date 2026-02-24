import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateProposalToken } from "@/lib/tokens";
import { DEFAULT_PRICING } from "@/lib/proposal-templates";
import { sendNotificationEmail } from "@/lib/resend";

export async function GET() {
  const proposals = await prisma.proposal.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ proposals });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { clientName, clientEmail, companyOverview, packageType } = body;

    if (!clientName || !companyOverview || !packageType) {
      return NextResponse.json(
        { error: "clientName, companyOverview, and packageType are required" },
        { status: 400 },
      );
    }

    const defaults = DEFAULT_PRICING[packageType];
    if (!defaults) {
      return NextResponse.json(
        { error: "Invalid packageType" },
        { status: 400 },
      );
    }

    const token = generateProposalToken();

    const proposal = await prisma.proposal.create({
      data: {
        token,
        clientName,
        clientEmail: clientEmail || null,
        companyOverview,
        packageType,
        setupFee: body.setupFee ?? defaults.setupFee,
        platformCost: body.platformCost ?? defaults.platformCost,
        retainerCost: body.retainerCost ?? defaults.retainerCost,
        status: "draft",
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const proposalUrl = `${appUrl}/p/${token}`;

    // If client email provided, send the proposal and mark as sent
    if (clientEmail) {
      try {
        await sendNotificationEmail({
          to: [clientEmail],
          subject: `Your proposal from Outsignal`,
          html: `<p>Hi ${clientName},</p><p>Your proposal is ready to review:</p><p><a href="${proposalUrl}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">View Proposal</a></p><p>Best regards,<br/>Outsignal</p>`,
        });
        await prisma.proposal.update({
          where: { id: proposal.id },
          data: { status: "sent" },
        });
      } catch {
        // Email failed — leave as draft
      }
    }

    return NextResponse.json({
      id: proposal.id,
      token: proposal.token,
      url: proposalUrl,
    });
  } catch (error) {
    console.error("Failed to create proposal:", error);
    return NextResponse.json(
      { error: "Failed to create proposal" },
      { status: 500 },
    );
  }
}
