import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStripeClient } from "@/lib/stripe";
import { PACKAGE_LABELS } from "@/lib/proposal-templates";

export async function POST(request: Request) {
  try {
    const { proposalId } = await request.json();

    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
    });
    if (!proposal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (proposal.status !== "accepted") {
      return NextResponse.json(
        { error: "Proposal must be accepted before payment" },
        { status: 400 },
      );
    }

    const stripe = getStripeClient();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const packageLabel =
      PACKAGE_LABELS[proposal.packageType] || proposal.packageType;

    // First month total = setup + platform + retainer
    const totalPence =
      proposal.setupFee + proposal.platformCost + proposal.retainerCost;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: totalPence,
            product_data: {
              name: `Outsignal — ${packageLabel}`,
              description: `First month: ${proposal.setupFee > 0 ? "setup fee + " : ""}platform costs + retainer`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/p/${proposal.token}/onboard?payment=success`,
      cancel_url: `${appUrl}/p/${proposal.token}?payment=cancelled`,
      metadata: { proposalId: proposal.id },
      customer_email: proposal.clientEmail || undefined,
    });

    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { stripeSessionId: session.id },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 },
    );
  }
}
