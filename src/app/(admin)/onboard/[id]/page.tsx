import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PACKAGE_LABELS, formatPence } from "@/lib/proposal-templates";
import { CopyLinkButton } from "@/components/proposals/copy-link-button";
import { MarkPaidButton } from "@/components/proposals/mark-paid-button";

const statusStyles: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-amber-100 text-amber-800",
  paid: "bg-emerald-100 text-emerald-800",
  onboarding_complete: "bg-brand/20 text-brand-foreground",
};

const STEPS = [
  "draft",
  "sent",
  "accepted",
  "paid",
  "onboarding_complete",
] as const;

interface ProposalDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProposalDetailPage({
  params,
}: ProposalDetailPageProps) {
  const { id } = await params;
  const proposal = await prisma.proposal.findUnique({ where: { id } });
  if (!proposal) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const proposalUrl = `${appUrl}/p/${proposal.token}`;
  const currentStepIndex = STEPS.indexOf(
    proposal.status as (typeof STEPS)[number],
  );

  return (
    <div>
      <Header
        title={proposal.clientName}
        description={PACKAGE_LABELS[proposal.packageType] || proposal.packageType}
        actions={
          <Badge className={`text-xs ${statusStyles[proposal.status] ?? ""}`}>
            {proposal.status.replace("_", " ")}
          </Badge>
        }
      />
      <div className="p-8 max-w-4xl space-y-6">
        {/* Status Timeline */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              {STEPS.map((step, i) => (
                <div key={step} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                        i <= currentStepIndex
                          ? "bg-emerald-500 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {i + 1}
                    </div>
                    <span className="mt-1 text-xs capitalize text-muted-foreground">
                      {step.replace("_", " ")}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`mx-2 h-0.5 w-12 ${
                        i < currentStepIndex ? "bg-emerald-500" : "bg-muted"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Proposal Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-medium text-muted-foreground">Client</p>
                <p>{proposal.clientName}</p>
              </div>
              {proposal.clientEmail && (
                <div>
                  <p className="font-medium text-muted-foreground">Email</p>
                  <p>{proposal.clientEmail}</p>
                </div>
              )}
              <div>
                <p className="font-medium text-muted-foreground">Overview</p>
                <p className="whitespace-pre-wrap">{proposal.companyOverview}</p>
              </div>
              <div>
                <p className="font-medium text-muted-foreground">Created</p>
                <p>{new Date(proposal.createdAt).toLocaleString()}</p>
              </div>
              {proposal.signedAt && (
                <div>
                  <p className="font-medium text-muted-foreground">Signed</p>
                  <p>
                    {proposal.signatureName} —{" "}
                    {new Date(proposal.signedAt).toLocaleString()}
                  </p>
                </div>
              )}
              {proposal.paidAt && (
                <div>
                  <p className="font-medium text-muted-foreground">Paid</p>
                  <p>
                    {new Date(proposal.paidAt).toLocaleString()}
                    {proposal.paidManually && " (manual)"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {proposal.setupFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Setup Fee</span>
                  <span>{formatPence(proposal.setupFee)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform Costs</span>
                <span>{formatPence(proposal.platformCost)}/mo</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Retainer</span>
                <span>{formatPence(proposal.retainerCost)}/mo</span>
              </div>
              <div className="flex justify-between border-t pt-3 font-bold">
                <span>Monthly Total</span>
                <span>
                  {formatPence(proposal.platformCost + proposal.retainerCost)}/mo
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <CopyLinkButton url={proposalUrl} />
            {proposal.status === "accepted" && (
              <MarkPaidButton proposalId={proposal.id} />
            )}
            {proposal.workspaceSlug && (
              <Link
                href={`/workspace/${proposal.workspaceSlug}`}
                className="inline-flex items-center rounded-md bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-200"
              >
                View Workspace
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
