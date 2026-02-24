import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ProposalDocument } from "@/components/proposal/proposal-document";
import { ProposalActions } from "@/components/proposal/proposal-actions";

interface ProposalPageProps {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ payment?: string }>;
}

export default async function ProposalPage({
  params,
  searchParams,
}: ProposalPageProps) {
  const { token } = await params;
  const { payment } = await searchParams;

  const proposal = await prisma.proposal.findUnique({ where: { token } });
  if (!proposal) notFound();

  // If paid, redirect to onboarding
  if (proposal.status === "paid") {
    redirect(`/p/${token}/onboard`);
  }

  // If onboarding complete, show thank you
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
        <h1 className="text-2xl font-bold text-gray-900">All done!</h1>
        <p className="mt-2 text-gray-600">
          Your onboarding is complete. We&apos;ll be in touch shortly to get
          your campaigns started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {payment === "cancelled" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Payment was cancelled. You can try again when you&apos;re ready.
        </div>
      )}

      <ProposalDocument
        clientName={proposal.clientName}
        companyOverview={proposal.companyOverview}
        packageType={proposal.packageType}
        setupFee={proposal.setupFee}
        platformCost={proposal.platformCost}
        retainerCost={proposal.retainerCost}
      />

      {/* E-signature or payment actions */}
      <ProposalActions
        proposalId={proposal.id}
        status={proposal.status}
      />
    </div>
  );
}
