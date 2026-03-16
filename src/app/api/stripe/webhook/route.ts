import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStripeClient } from "@/lib/stripe";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const stripe = getStripeClient();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json(
      { error: "Missing signature or webhook secret" },
      { status: 400 },
    );
  }

  let event;
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const proposalId = session.metadata?.proposalId;

    if (proposalId) {
      const proposal = await prisma.proposal.update({
        where: { id: proposalId },
        data: {
          status: "paid",
          paidAt: new Date(),
        },
      });

      notify({
        type: "proposal",
        severity: "info",
        title: `Payment received: ${proposal.clientName || "Unknown"}`,
        metadata: { proposalId: proposal.id },
      }).catch(() => {});

      // Send onboarding link to client
      const esc = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
      if (proposal.clientEmail) {
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        audited(
          { notificationType: "payment_onboarding", channel: "email", recipient: proposal.clientEmail },
          () => sendNotificationEmail({
            to: [proposal.clientEmail!],
            subject: "Payment received — Complete your onboarding",
            html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f5;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background-color:#18181b;padding:20px 32px;border-radius:8px 8px 0 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:3px;color:#635BFF;">OUTSIGNAL</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background-color:#ffffff;padding:32px 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;padding-bottom:24px;line-height:1.3;">Payment Received</td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;padding-bottom:24px;line-height:1.7;">Hi ${esc(proposal.clientName || "")}, thank you for your payment. Please complete your onboarding to get started.</td>
              </tr>
              <!-- CTA button -->
              <tr>
                <td>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#635BFF;border-radius:8px;">
                        <a href="${appUrl}/p/${proposal.token}/onboard" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Start Onboarding</a>
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
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; Complete your onboarding to get started with your campaigns.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
          }),
        ).catch((err) => console.error("Failed to send onboarding email:", err));
      }
    }
  }

  return NextResponse.json({ received: true });
}
