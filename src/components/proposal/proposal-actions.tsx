"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ESignature } from "./e-signature";
import { Button } from "@/components/ui/button";

interface ProposalActionsProps {
  proposalId: string;
  status: string;
}

export function ProposalActions({ proposalId, status }: ProposalActionsProps) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState(status);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSigned() {
    setCurrentStatus("accepted");
    // Immediately proceed to payment
    await handlePayment();
  }

  async function handlePayment() {
    setPaymentLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });

      if (!res.ok) {
        const data = await res.json();
        // If Stripe is not configured, show a message
        if (data.error?.includes("STRIPE_SECRET_KEY")) {
          setError(
            "Payment processing is not yet configured. Please contact us to arrange payment.",
          );
          return;
        }
        throw new Error(data.error || "Failed to create checkout");
      }

      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment error");
    } finally {
      setPaymentLoading(false);
    }
  }

  // Show e-signature for draft/sent proposals
  if (currentStatus === "draft" || currentStatus === "sent") {
    return <ESignature proposalId={proposalId} onSigned={handleSigned} />;
  }

  // Show payment button for accepted proposals
  if (currentStatus === "accepted") {
    return (
      <div className="space-y-4 rounded-lg border p-6">
        <h3 className="text-lg font-semibold text-gray-900">
          Proposal Accepted
        </h3>
        <p className="text-sm text-gray-600">
          Thank you for accepting the proposal. Please proceed to payment to get
          started.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button
          onClick={handlePayment}
          disabled={paymentLoading}
          className="w-full"
          size="lg"
        >
          {paymentLoading ? "Redirecting to payment..." : "Proceed to Payment"}
        </Button>
      </div>
    );
  }

  return null;
}
