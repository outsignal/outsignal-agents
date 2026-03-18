import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateProposalToken } from "@/lib/tokens";
import { DEFAULT_PRICING } from "@/lib/proposal-templates";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { notify } from "@/lib/notify";
import { parseJsonBody } from "@/lib/parse-json";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { createProposalSchema } from "@/lib/validations/proposals";
import { emailLayout, emailButton, emailNotice } from "@/lib/email-template";

export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const proposals = await prisma.proposal.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ proposals });
}

export async function POST(request: Request) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;
    const result = createProposalSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }
    const { clientName, clientEmail, companyOverview, packageType } = result.data;

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
        setupFee: result.data.setupFee ?? defaults.setupFee,
        platformCost: result.data.platformCost ?? defaults.platformCost,
        retainerCost: result.data.retainerCost ?? defaults.retainerCost,
        status: "draft",
      },
    });

    notify({
      type: "proposal",
      severity: "info",
      title: `Proposal created: ${clientName}`,
      metadata: { proposalId: proposal.id },
    }).catch(() => {});

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const proposalUrl = `${appUrl}/p/${token}`;

    // If client email provided, send the proposal and mark as sent
    if (clientEmail) {
      try {
        await audited(
          { notificationType: "proposal", channel: "email", recipient: clientEmail },
          () => sendNotificationEmail({
            to: [clientEmail],
            subject: `Your proposal from Outsignal`,
            html: emailLayout({
              body: `
                <h1 style="margin:0 0 6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#2F2F2F;line-height:1.3;">Your Custom Plan</h1>
                <p style="margin:0 0 28px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#635BFF;line-height:1.3;">is Ready</p>
                <p style="margin:0 0 32px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#6B6B6B;line-height:1.7;">Hi ${clientName}, we've put together a tailored outreach plan for you. Review the details and let us know when you're ready to get started.</p>
                ${emailButton("View Proposal", proposalUrl)}
                <div style="height:32px;"></div>
                <div style="border-top:1px solid #E8E5E1;margin-bottom:28px;"></div>
                ${emailNotice("This proposal was created specifically for you. If you have any questions, reply to this email.")}
              `,
              footerNote: `This proposal was prepared for ${clientName}.`,
            }),
          }),
        );
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
