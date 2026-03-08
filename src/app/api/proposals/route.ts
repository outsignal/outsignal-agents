import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateProposalToken } from "@/lib/tokens";
import { DEFAULT_PRICING } from "@/lib/proposal-templates";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { notify } from "@/lib/notify";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { createProposalSchema } from "@/lib/validations/proposals";

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
    const body = await request.json();
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
            html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f5;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background-color:#18181b;padding:20px 32px;border-radius:8px 8px 0 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:3px;color:#F0FF7A;">OUTSIGNAL</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background-color:#ffffff;padding:32px 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;padding-bottom:24px;line-height:1.3;">Your Proposal is Ready</td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;padding-bottom:24px;line-height:1.7;">Hi ${clientName}, your proposal from Outsignal is ready to review.</td>
              </tr>
              <!-- CTA button -->
              <tr>
                <td>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#F0FF7A;border-radius:8px;">
                        <a href="${proposalUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#18181b;text-decoration:none;">View Proposal</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; This proposal was created for you.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
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
