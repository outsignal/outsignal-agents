import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStripeClient } from "@/lib/stripe";
import { sendNotificationEmail } from "@/lib/resend";
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
      if (proposal.clientEmail) {
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        sendNotificationEmail({
          to: [proposal.clientEmail],
          subject: "Payment received — Complete your onboarding",
          html: `<p>Hi ${proposal.clientName},</p><p>Thank you for your payment. Please complete your onboarding to get started:</p><p><a href="${appUrl}/p/${proposal.token}/onboard" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;">Start Onboarding</a></p><p>Best regards,<br/>Outsignal</p>`,
        }).catch((err) => console.error("Failed to send onboarding email:", err));
      }
    }
  }

  return NextResponse.json({ received: true });
}
