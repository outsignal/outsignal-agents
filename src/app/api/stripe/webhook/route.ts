import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStripeClient } from "@/lib/stripe";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { notify } from "@/lib/notify";
import { emailLayout, emailHeading, emailButton, emailText } from "@/lib/email-template";

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
        const onboardingHtml = emailLayout({
          body: [
            emailHeading("Payment Received"),
            emailText(`Hi ${esc(proposal.clientName || "")}, thank you for your payment. Please complete your onboarding to get started.`),
            emailButton("Start Onboarding", `${appUrl}/p/${proposal.token}/onboard`),
          ].join(""),
          footerNote: "Complete your onboarding to get started with your campaigns.",
        });
        audited(
          { notificationType: "payment_onboarding", channel: "email", recipient: proposal.clientEmail },
          () => sendNotificationEmail({
            to: [proposal.clientEmail!],
            subject: "Payment received — Complete your onboarding",
            html: onboardingHtml,
          }),
        ).catch((err) => console.error("Failed to send onboarding email:", err));
      }
    }
  }

  return NextResponse.json({ received: true });
}
