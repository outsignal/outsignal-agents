import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { OnboardingClient } from "@/components/onboarding/onboarding-client";

interface OnboardPageProps {
  params: Promise<{ token: string }>;
}

export default async function CustomerOnboardPage({
  params,
}: OnboardPageProps) {
  const { token } = await params;

  const proposal = await prisma.proposal.findUnique({ where: { token } });
  if (!proposal) notFound();

  // Must be paid to access onboarding
  if (
    proposal.status === "draft" ||
    proposal.status === "sent" ||
    proposal.status === "accepted"
  ) {
    redirect(`/p/${token}`);
  }

  // Already complete
  if (proposal.status === "onboarding_complete") {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <svg
            className="h-8 w-8 text-emerald-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">
          Onboarding already complete
        </h1>
        <p className="mt-2 text-gray-600">
          Your onboarding has been submitted. We&apos;ll be in touch shortly.
        </p>
      </div>
    );
  }

  return (
    <OnboardingClient
      proposalToken={token}
      prefillName={proposal.clientName}
      prefillEmail={proposal.clientEmail || undefined}
    />
  );
}
