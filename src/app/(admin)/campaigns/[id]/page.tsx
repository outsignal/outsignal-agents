import { notFound } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCampaign } from "@/lib/campaigns/operations";
import { prisma } from "@/lib/db";
import { DeployButton } from "./DeployButton";
import { DeployHistory } from "./DeployHistory";
import { SignalStatusButton } from "./SignalStatusButton";
import {
  Building2,
  CheckCircle2,
  Users,
  Mail,
  LinkedinIcon,
  Target,
  Clock,
  Zap,
} from "lucide-react";

interface CampaignDetailPageProps {
  params: Promise<{ id: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Lifecycle Stepper ────────────────────────────────────────────────────────

const LIFECYCLE_STEPS = [
  { key: "draft", label: "Draft" },
  { key: "internal_review", label: "Review" },
  { key: "pending_approval", label: "Approval" },
  { key: "approved", label: "Approved" },
  { key: "active", label: "Active" },
];

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  internal_review: 1,
  pending_approval: 2,
  approved: 3,
  deployed: 4,
  active: 4,
  paused: 4,
  completed: 5,
  archived: 5,
};

function LifecycleStepper({ status }: { status: string }) {
  const currentIdx = STATUS_ORDER[status] ?? 0;

  return (
    <div className="flex items-center gap-0">
      {LIFECYCLE_STEPS.map((step, i) => {
        const isComplete = i < currentIdx;
        const isCurrent = i === currentIdx;

        return (
          <div key={step.key} className="flex items-center">
            {i > 0 && (
              <div
                className={`h-px w-6 ${isComplete ? "bg-brand" : "bg-border"}`}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                  isComplete
                    ? "bg-brand text-brand-foreground"
                    : isCurrent
                      ? "border-2 border-brand text-brand bg-transparent"
                      : "border border-border text-muted-foreground bg-transparent"
                }`}
              >
                {isComplete ? (
                  <CheckCircle2 className="size-3.5" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-[11px] font-medium whitespace-nowrap ${
                  isComplete || isCurrent
                    ? "text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CampaignDetailPage({
  params,
}: CampaignDetailPageProps) {
  const { id } = await params;

  const [campaign, signalLeadCount] = await Promise.all([
    getCampaign(id),
    prisma.signalCampaignLead
      .count({ where: { campaignId: id, outcome: "added" } })
      .catch(() => 0),
  ]);

  if (!campaign) notFound();

  // Fetch workspace name
  const workspace = await prisma.workspace.findUnique({
    where: { slug: campaign.workspaceSlug },
    select: { name: true },
  });

  const emailStepCount = Array.isArray(campaign.emailSequence)
    ? campaign.emailSequence.length
    : 0;
  const linkedinStepCount = Array.isArray(campaign.linkedinSequence)
    ? campaign.linkedinSequence.length
    : 0;
  const leadCount = campaign.targetListPeopleCount ?? 0;

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb
        items={[
          { label: "Campaigns", href: "/campaigns" },
          { label: campaign.name },
        ]}
      />

      {/* ─── Compact header ──────────────────────────────────────────────── */}
      <header className="border-b border-border/50 px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg font-medium text-foreground">
                {campaign.name}
              </h1>
              <StatusBadge status={campaign.status} type="campaign" />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
              <Link
                href={`/workspace/${campaign.workspaceSlug}`}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <Building2 className="size-3" />
                {workspace?.name ?? campaign.workspaceSlug}
              </Link>
              <span className="flex items-center gap-1">
                {campaign.channels.includes("email") && <Mail className="size-3" />}
                {campaign.channels.includes("linkedin") && <LinkedinIcon className="size-3" />}
                {campaign.channels.join(" + ")}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="size-3" />
                Created {formatDateTime(new Date(campaign.createdAt))}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {campaign.type === "signal" ? (
              (campaign.status === "active" || campaign.status === "paused") && (
                <SignalStatusButton
                  campaignId={campaign.id}
                  currentStatus={campaign.status}
                />
              )
            ) : (
              <DeployButton
                campaignId={campaign.id}
                campaignName={campaign.name}
                status={campaign.status}
                leadsApproved={campaign.leadsApproved}
                contentApproved={campaign.contentApproved}
                channels={campaign.channels}
                leadCount={leadCount}
                emailStepCount={emailStepCount}
                linkedinStepCount={linkedinStepCount}
              />
            )}
          </div>
        </div>
      </header>

      {/* ─── Content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 p-6 space-y-6 overflow-auto">
        {/* Lifecycle stepper */}
        <LifecycleStepper status={campaign.status} />

        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-md bg-brand/10 flex items-center justify-center">
                <Users className="size-3.5 text-brand" />
              </div>
              <span className="text-xs text-muted-foreground">Leads</span>
            </div>
            <p className="text-xl font-semibold tabular-nums">
              {leadCount.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-7 w-7 rounded-md bg-brand/10 flex items-center justify-center">
                <Target className="size-3.5 text-brand" />
              </div>
              <span className="text-xs text-muted-foreground">Target List</span>
            </div>
            <p className="text-sm font-semibold truncate">
              {campaign.targetListName ?? "—"}
            </p>
          </div>
          {emailStepCount > 0 && (
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-md bg-brand/10 flex items-center justify-center">
                  <Mail className="size-3.5 text-brand" />
                </div>
                <span className="text-xs text-muted-foreground">Email Steps</span>
              </div>
              <p className="text-xl font-semibold tabular-nums">{emailStepCount}</p>
            </div>
          )}
          {linkedinStepCount > 0 && (
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-7 w-7 rounded-md bg-brand/10 flex items-center justify-center">
                  <LinkedinIcon className="size-3.5 text-brand" />
                </div>
                <span className="text-xs text-muted-foreground">LinkedIn Steps</span>
              </div>
              <p className="text-xl font-semibold tabular-nums">{linkedinStepCount}</p>
            </div>
          )}
        </div>

        {/* ─── Approval progress ───────────────────────────────────────── */}
        <Card density="compact">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Approval Progress</CardTitle>
                <CardDescription>Lead and content sign-off status</CardDescription>
              </div>
              {/* Mini stepper */}
              <div className="flex items-center gap-0 shrink-0">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                      campaign.leadsApproved
                        ? "bg-emerald-500 text-white"
                        : "border-2 border-brand text-brand"
                    }`}
                  >
                    {campaign.leadsApproved ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      "1"
                    )}
                  </div>
                  <span className="text-[11px] font-medium">Leads</span>
                </div>
                <div className={`h-px w-6 mx-1 ${campaign.leadsApproved ? "bg-emerald-400" : "bg-border"}`} />
                <div className="flex items-center gap-1.5">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                      campaign.contentApproved
                        ? "bg-emerald-500 text-white"
                        : campaign.leadsApproved
                          ? "border-2 border-brand text-brand"
                          : "border border-border text-muted-foreground"
                    }`}
                  >
                    {campaign.contentApproved ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      "2"
                    )}
                  </div>
                  <span className="text-[11px] font-medium">Content</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div
                className={`rounded-lg border p-4 ${
                  campaign.leadsApproved
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30"
                    : "border-border bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {campaign.leadsApproved ? (
                    <CheckCircle2 className="size-4 text-emerald-500" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                  )}
                  <p className="text-xs font-medium">Leads</p>
                </div>
                <p className="text-xs text-muted-foreground ml-6">
                  {campaign.leadsApproved
                    ? campaign.leadsApprovedAt
                      ? `Approved ${formatDateTime(new Date(campaign.leadsApprovedAt))}`
                      : "Approved"
                    : campaign.leadsFeedback
                      ? <>
                          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 text-[10px] font-medium mr-1">
                            Feedback
                          </span>
                          {campaign.leadsFeedback}
                        </>
                      : "Pending client approval"}
                </p>
              </div>
              <div
                className={`rounded-lg border p-4 ${
                  campaign.contentApproved
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30"
                    : "border-border bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {campaign.contentApproved ? (
                    <CheckCircle2 className="size-4 text-emerald-500" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                  )}
                  <p className="text-xs font-medium">Content</p>
                </div>
                <p className="text-xs text-muted-foreground ml-6">
                  {campaign.contentApproved
                    ? campaign.contentApprovedAt
                      ? `Approved ${formatDateTime(new Date(campaign.contentApprovedAt))}`
                      : "Approved"
                    : campaign.contentFeedback
                      ? <>
                          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 text-[10px] font-medium mr-1">
                            Feedback
                          </span>
                          {campaign.contentFeedback}
                        </>
                      : "Pending client approval"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── Signal campaign stats ──────────────────────────────────── */}
        {campaign.type === "signal" && (
          <Card density="compact">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-brand" />
                <CardTitle>Signal Stats</CardTitle>
              </div>
              <CardDescription>
                Signal matching configuration and live metrics
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Signal Types</p>
                  <div className="flex flex-wrap gap-1">
                    {campaign.signalTypes && campaign.signalTypes.length > 0
                      ? campaign.signalTypes.map((t) => (
                          <span
                            key={t}
                            className="inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand"
                          >
                            {t}
                          </span>
                        ))
                      : <span className="text-sm text-muted-foreground">—</span>}
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Daily Cap</p>
                  <p className="text-lg font-semibold tabular-nums">{campaign.dailyLeadCap}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1">ICP Threshold</p>
                  <p className="text-lg font-semibold tabular-nums">{campaign.icpScoreThreshold}/100</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Last Processed</p>
                  <p className="text-sm font-medium">
                    {campaign.lastSignalProcessedAt
                      ? formatDateTime(new Date(campaign.lastSignalProcessedAt))
                      : "Never"}
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Leads Added</p>
                  <p className="text-lg font-semibold tabular-nums">{signalLeadCount.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ─── Deploy history ────────────────────────────────────────── */}
        {campaign.type !== "signal" && (
          <Card>
            <CardHeader>
              <CardTitle>Deploy History</CardTitle>
              <CardDescription>
                All deployments for this campaign
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <DeployHistory campaignId={campaign.id} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
