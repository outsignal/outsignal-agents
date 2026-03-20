import Link from "next/link";
import { prisma } from "@/lib/db";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";
import { OnboardPageClient } from "../onboard/onboard-page-client";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const [proposals, onboardingInvites] = await Promise.all([
    prisma.proposal.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.onboardingInvite.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Compute status counts for proposals
  const proposalStatusCounts: Record<string, number> = {};
  for (const p of proposals) {
    proposalStatusCounts[p.status] = (proposalStatusCounts[p.status] ?? 0) + 1;
  }

  // Compute status counts for invites
  const inviteStatusCounts: Record<string, number> = {};
  for (const inv of onboardingInvites) {
    inviteStatusCounts[inv.status] = (inviteStatusCounts[inv.status] ?? 0) + 1;
  }

  const totalProposals = proposals.length;
  const totalInvites = onboardingInvites.length;
  const sentProposals = proposalStatusCounts["sent"] ?? 0;
  const acceptedProposals = proposalStatusCounts["accepted"] ?? 0;
  const paidProposals = proposalStatusCounts["paid"] ?? 0;
  const completedOnboarding = proposalStatusCounts["onboarding_complete"] ?? 0;
  const pendingInvites =
    (inviteStatusCounts["draft"] ?? 0) +
    (inviteStatusCounts["sent"] ?? 0) +
    (inviteStatusCounts["viewed"] ?? 0);
  const completedInvites = inviteStatusCounts["completed"] ?? 0;

  // Serialize for client component
  const serializedProposals = proposals.map((p) => ({
    id: p.id,
    token: p.token,
    status: p.status,
    clientName: p.clientName,
    clientEmail: p.clientEmail ?? undefined,
    companyOverview: p.companyOverview,
    packageType: p.packageType,
    setupFee: p.setupFee,
    platformCost: p.platformCost,
    retainerCost: p.retainerCost,
    createdAt: p.createdAt.toISOString(),
  }));

  const serializedInvites = onboardingInvites.map((inv) => ({
    id: inv.id,
    token: inv.token,
    status: inv.status,
    clientName: inv.clientName,
    clientEmail: inv.clientEmail ?? undefined,
    createWorkspace: inv.createWorkspace,
    workspaceSlug: inv.workspaceSlug ?? undefined,
    createdAt: inv.createdAt.toISOString(),
  }));

  // Summary subtitle
  const subtitleParts: string[] = [];
  if (totalProposals > 0) {
    subtitleParts.push(
      `${totalProposals} proposal${totalProposals !== 1 ? "s" : ""}`,
    );
  }
  if (totalInvites > 0) {
    subtitleParts.push(
      `${totalInvites} onboarding invite${totalInvites !== 1 ? "s" : ""}`,
    );
  }
  const subtitle =
    subtitleParts.length > 0
      ? subtitleParts.join(", ")
      : "No proposals or onboarding invites yet";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex flex-col gap-3 border-b border-border/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
        <div className="min-w-0">
          <h1 className="text-xl font-medium text-foreground">Sales</h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/onboard/new">
            <Button variant="brand" size="sm">
              <Plus className="h-4 w-4" />
              New Proposal
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 min-h-0 p-6 space-y-6 overflow-auto">
        {/* Metric cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <MetricCard
            label="Total Proposals"
            value={totalProposals}
            icon="FileText"
            density="compact"
            accentColor="#635BFF"
          />
          <MetricCard
            label="Sent / Accepted"
            value={sentProposals + acceptedProposals}
            icon="Send"
            density="compact"
            accentColor="#3b82f6"
            detail={
              sentProposals + acceptedProposals > 0
                ? `${sentProposals} sent, ${acceptedProposals} accepted`
                : undefined
            }
          />
          <MetricCard
            label="Paid"
            value={paidProposals}
            icon="CheckCircle"
            density="compact"
            accentColor="#10b981"
          />
          <MetricCard
            label="Onboarded"
            value={completedOnboarding + completedInvites}
            icon="CheckCircle"
            density="compact"
            accentColor="#635BFF"
          />
          <MetricCard
            label="Pending Invites"
            value={pendingInvites}
            icon="Mail"
            density="compact"
            accentColor={pendingInvites > 0 ? "#f59e0b" : "#94a3b8"}
          />
        </div>

        {/* Tables (client component for interactivity) */}
        <OnboardPageClient
          proposals={serializedProposals}
          onboardingInvites={serializedInvites}
          appUrl={appUrl}
        />
      </div>
    </div>
  );
}
