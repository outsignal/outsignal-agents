import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyLinkButton } from "@/components/proposals/copy-link-button";
import { SendInviteButton } from "@/components/onboarding/send-invite-button";

const statusStyles: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  sent: "bg-blue-100 text-blue-800",
  viewed: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
};

const STEPS = ["draft", "sent", "viewed", "completed"] as const;

interface OnboardingInviteDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function OnboardingInviteDetailPage({
  params,
}: OnboardingInviteDetailPageProps) {
  const { id } = await params;
  const invite = await prisma.onboardingInvite.findUnique({ where: { id } });
  if (!invite) notFound();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const inviteUrl = `${appUrl}/o/${invite.token}`;
  const currentStepIndex = STEPS.indexOf(
    invite.status as (typeof STEPS)[number],
  );

  return (
    <div>
      <Header
        title={invite.clientName}
        description="Onboarding invite"
        actions={
          <Badge className={`text-xs ${statusStyles[invite.status] ?? ""}`}>
            {invite.status}
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
                      {step}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`mx-2 h-0.5 w-16 ${
                        i < currentStepIndex ? "bg-emerald-500" : "bg-muted"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Invite Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-muted-foreground">Client</p>
              <p>{invite.clientName}</p>
            </div>
            {invite.clientEmail && (
              <div>
                <p className="font-medium text-muted-foreground">Email</p>
                <p>{invite.clientEmail}</p>
              </div>
            )}
            <div>
              <p className="font-medium text-muted-foreground">Created</p>
              <p>{new Date(invite.createdAt).toLocaleString()}</p>
            </div>
            {invite.proposalId && (
              <div>
                <p className="font-medium text-muted-foreground">
                  Linked Proposal
                </p>
                <Link
                  href={`/onboard/${invite.proposalId}`}
                  className="text-blue-600 hover:underline"
                >
                  View Proposal
                </Link>
              </div>
            )}
            {invite.workspaceSlug && (
              <div>
                <p className="font-medium text-muted-foreground">Workspace</p>
                <Link
                  href={`/workspace/${invite.workspaceSlug}`}
                  className="text-blue-600 hover:underline"
                >
                  {invite.workspaceSlug}
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <CopyLinkButton url={inviteUrl} />
            {invite.clientEmail && invite.status !== "completed" && (
              <SendInviteButton inviteId={invite.id} />
            )}
            {invite.workspaceSlug && (
              <Link
                href={`/workspace/${invite.workspaceSlug}`}
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
