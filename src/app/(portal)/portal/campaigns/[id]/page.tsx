import { notFound, redirect } from "next/navigation";
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign } from "@/lib/campaigns/operations";
import { hasContentDrifted } from "@/lib/campaigns/content-integrity";
import { CampaignDetailTabs } from "@/components/portal/campaign-detail-tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import type { EmailActivityPoint } from "@/components/charts/email-activity-chart";
import { ArrowLeft, Mail, Linkedin, Clock, CalendarDays, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCampaignLeadSample } from "@/lib/campaigns/operations";
import { CampaignApprovalLeads } from "@/components/portal/campaign-approval-leads";
import { CampaignApprovalContent } from "@/components/portal/campaign-approval-content";
import { Card, CardContent } from "@/components/ui/card";
import { initAdapters, getAdapter } from "@/lib/channels";
import { buildRef } from "@/lib/channels/helpers";
import type { ChannelType } from "@/lib/channels/constants";
import type { UnifiedMetrics, UnifiedStep } from "@/lib/channels/types";


export default async function PortalCampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step: stepParam } = await searchParams;
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  const campaign = await getCampaign(id);
  if (!campaign || campaign.workspaceSlug !== workspaceSlug) {
    notFound();
  }
  const hasApprovalBaseline = Boolean(
    campaign.contentApprovedAt ||
      campaign.approvedContentHash ||
      campaign.approvedContentSnapshot,
  );
  const contentDrifted = hasApprovalBaseline
    ? await hasContentDrifted(campaign.id)
    : false;
  const approvedContentVersion = campaign.approvedContentHash?.slice(0, 12) ?? null;

  // Bootstrap adapters
  initAdapters();
  const ref = buildRef(campaign, workspaceSlug);

  // Fetch lead sample for approval view
  let leadSample: { leads: Array<{ personId: string; firstName: string | null; lastName: string | null; jobTitle: string | null; company: string | null; location: string | null; linkedinUrl: string | null; icpScore: number | null }>; totalCount: number } | null = null;
  if (campaign.status === "pending_approval" && campaign.targetListId) {
    leadSample = await getCampaignLeadSample(campaign.targetListId, session.workspaceSlug, 500);
  }

  const hasPerformanceData = ["active", "paused", "completed"].includes(campaign.status);
  const needsSequenceSteps = hasPerformanceData || campaign.status === "pending_approval";

  // Fetch metrics and sequence steps via adapters for all campaign channels
  let metrics: UnifiedMetrics[] = [];
  let sequenceSteps: UnifiedStep[] = [];

  if (hasPerformanceData) {
    try {
      const [metricsResults, stepsResults] = await Promise.all([
        Promise.all(
          campaign.channels.map(async (ch: string) => {
            const adapter = getAdapter(ch as ChannelType);
            return adapter.getMetrics(ref);
          })
        ),
        Promise.all(
          campaign.channels.map(async (ch: string) =>
            getAdapter(ch as ChannelType).getSequenceSteps(ref)
          )
        ),
      ]);
      metrics = metricsResults;
      sequenceSteps = stepsResults.flat();
    } catch {
      // Silently fail — stats are non-critical
    }
  } else if (needsSequenceSteps) {
    // Pending approval: only fetch sequence steps (not metrics)
    try {
      const stepsResults = await Promise.all(
        campaign.channels.map(async (ch: string) =>
          getAdapter(ch as ChannelType).getSequenceSteps(ref)
        )
      );
      sequenceSteps = stepsResults.flat();
    } catch {
      // Silently fail
    }
  }

  // Fetch replies for this campaign (channel-agnostic — stays as direct query)
  const replies = await prisma.reply.findMany({
    where: { campaignId: campaign.id, workspaceSlug },
    orderBy: { receivedAt: "desc" },
    take: 50,
    select: {
      id: true,
      senderEmail: true,
      senderName: true,
      subject: true,
      bodyText: true,
      receivedAt: true,
      intent: true,
      sentiment: true,
      emailBisonReplyId: true,
      emailBisonParentId: true,
    },
  });

  // Fetch chart data — email channel: bucket WebhookEvents by date
  // LinkedIn channel: bucket completed LinkedInActions by date
  // Keep chart bucketing server-side; adapters provide flat action lists
  let chartData: EmailActivityPoint[] = [];
  if (hasPerformanceData) {
    try {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 30);

      if (campaign.channels.includes("email") && campaign.emailBisonCampaignId) {
        // Email channel chart data from WebhookEvent table
        const chartEvents = await prisma.webhookEvent.findMany({
          where: {
            workspace: workspaceSlug,
            campaignId: String(campaign.emailBisonCampaignId),
            receivedAt: { gte: sinceDate },
            eventType: {
              in: [
                "EMAIL_SENT",
                "LEAD_REPLIED",
                "LEAD_INTERESTED",
                "EMAIL_BOUNCED",
                "LEAD_UNSUBSCRIBED",
              ],
            },
            isAutomated: false,
          },
          select: { receivedAt: true, eventType: true },
          orderBy: { receivedAt: "asc" },
        });

        const buckets = new Map<string, EmailActivityPoint>();
        for (const evt of chartEvents) {
          const dateKey = evt.receivedAt.toISOString().slice(0, 10);
          if (!buckets.has(dateKey)) {
            buckets.set(dateKey, { date: dateKey, sent: 0, replied: 0, bounced: 0, interested: 0, unsubscribed: 0 });
          }
          const bucket = buckets.get(dateKey)!;
          switch (evt.eventType) {
            case "EMAIL_SENT":
              bucket.sent = (bucket.sent ?? 0) + 1;
              break;
            case "LEAD_REPLIED":
              bucket.replied = (bucket.replied ?? 0) + 1;
              break;
            case "EMAIL_BOUNCED":
              bucket.bounced = (bucket.bounced ?? 0) + 1;
              break;
            case "LEAD_INTERESTED":
              bucket.interested = (bucket.interested ?? 0) + 1;
              break;
            case "LEAD_UNSUBSCRIBED":
              bucket.unsubscribed = (bucket.unsubscribed ?? 0) + 1;
              break;
          }
        }
        chartData = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
      } else if (campaign.channels.includes("linkedin") && !campaign.channels.includes("email")) {
        // LinkedIn-only chart data: use adapter.getActions() and bucket by date
        const liActions = await getAdapter("linkedin" as ChannelType).getActions(ref);
        const cutoff = sinceDate.getTime();

        const buckets = new Map<string, EmailActivityPoint>();
        for (const action of liActions) {
          if (action.performedAt.getTime() < cutoff) continue;
          const dateKey = action.performedAt.toISOString().slice(0, 10);
          if (!buckets.has(dateKey)) {
            buckets.set(dateKey, { date: dateKey, sent: 0, replied: 0 });
          }
          const bucket = buckets.get(dateKey)!;
          // Map connect actions -> "sent" slot, messages -> "replied" slot for chart reuse
          if (action.actionType === "connect" || action.actionType === "connection_request") {
            bucket.sent = (bucket.sent ?? 0) + 1;
          } else if (action.actionType === "message") {
            bucket.replied = (bucket.replied ?? 0) + 1;
          }
        }
        chartData = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
      }
    } catch {
      // Silently fail — chart is non-critical
    }
  }

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const formatDateTime = (date: Date) =>
    `${formatDate(date)} at ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;


  const isPendingApproval = campaign.status === "pending_approval";

  // Wizard step: default to "content" if leads already approved, otherwise "leads".
  // User can override via ?step= to navigate freely between steps.
  const activeStep = isPendingApproval
    ? (stepParam === "leads" || stepParam === "content")
      ? stepParam
      : campaign.leadsApproved ? "content" : "leads"
    : null;

  // Build EB sequence steps shape for CampaignApprovalContent (still needs raw EB format)
  // We use the UnifiedStep array derived from the adapter but re-shape it to the EB type
  // Note: CampaignApprovalContent uses ebSequenceSteps for display only — this is the approval flow
  const ebSequenceStepsForApproval = sequenceSteps
    .filter((s) => s.channel === "email")
    .map((s) => ({
      id: s.stepNumber,
      campaign_id: campaign.emailBisonCampaignId ?? 0,
      position: s.stepNumber,
      subject: s.subjectLine ?? undefined,
      body: s.bodyHtml ?? undefined,
      delay_days: s.delayDays,
    }));

  return (
    <div className={isPendingApproval ? "p-4 space-y-4" : "p-6 space-y-6"}>
      {/* Header — compact for approval, full for other statuses */}
      <div>
        <Link
          href="/portal/campaigns"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Campaigns
        </Link>

        {isPendingApproval ? (
          /* Compact two-row header for approval flow */
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-lg font-medium text-foreground">{campaign.name}</h1>
                <StatusBadge status={campaign.status} type="campaign" />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                {campaign.description && (
                  <span>{campaign.description}</span>
                )}
                <span className="inline-flex items-center gap-1">
                  {campaign.channels.includes("email") && <><Mail className="h-3 w-3" /> Email</>}
                  {campaign.channels.includes("email") && campaign.channels.includes("linkedin") && <span className="mx-0.5">·</span>}
                  {campaign.channels.includes("linkedin") && <><Linkedin className="h-3 w-3" /> LinkedIn</>}
                </span>
                <span>Created {formatDate(campaign.createdAt)}</span>
              </div>
            </div>
            {/* Stepper on the right — clickable to navigate between steps */}
            <div className="flex items-center gap-0 shrink-0 pt-1">
              <Link
                href={`/portal/campaigns/${campaign.id}?step=leads`}
                className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
              >
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    campaign.leadsApproved
                      ? "bg-brand text-white"
                      : "border-2 border-brand text-brand"
                  }`}
                >
                  {campaign.leadsApproved ? <CheckCircle2 className="h-3.5 w-3.5" /> : "1"}
                </div>
                <span className={`text-xs font-medium ${activeStep === "leads" ? "text-foreground" : campaign.leadsApproved ? "text-brand" : "text-foreground"}`}>
                  Leads
                </span>
              </Link>
              <div className={`mx-2.5 h-px w-8 ${campaign.leadsApproved ? "bg-brand" : "bg-border"}`} />
              <Link
                href={`/portal/campaigns/${campaign.id}?step=content`}
                className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
              >
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    campaign.contentApproved
                      ? "bg-brand text-white"
                      : "border-2 border-brand text-brand"
                  }`}
                >
                  {campaign.contentApproved ? <CheckCircle2 className="h-3.5 w-3.5" /> : "2"}
                </div>
                <span className={`text-xs font-medium ${
                  campaign.contentApproved ? "text-brand" : "text-foreground"
                }`}>
                  Content
                </span>
              </Link>
            </div>
          </div>
        ) : (
          /* Full header for non-approval statuses */
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-medium text-foreground">{campaign.name}</h1>
                  <StatusBadge status={campaign.status} type="campaign" />
                </div>
                {campaign.description && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {campaign.description}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm text-muted-foreground">
              {campaign.channels.includes("email") && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> Email
                </span>
              )}
              {campaign.channels.includes("linkedin") && (
                <span className="inline-flex items-center gap-1.5">
                  <Linkedin className="h-3.5 w-3.5" /> LinkedIn
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                Created {formatDate(campaign.createdAt)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Last updated {formatDateTime(campaign.updatedAt)}
              </span>
              {approvedContentVersion && (
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approved content version {approvedContentVersion}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {hasApprovalBaseline && contentDrifted && (
        <Card className="border-amber-300/60 bg-amber-50/60 dark:border-amber-700/50 dark:bg-amber-950/20">
          <CardContent className="py-4 text-sm text-amber-950 dark:text-amber-100">
            <div className="font-medium">
              Content has been modified since client approval — re-approval needed.
            </div>
            <div className="mt-1 text-amber-900/80 dark:text-amber-200/80">
              {campaign.contentApprovedAt
                ? `Last approved ${formatDateTime(new Date(campaign.contentApprovedAt))}. `
                : ""}
              {approvedContentVersion
                ? `Approved version ${approvedContentVersion} no longer matches the current sequence content.`
                : "The current sequence content no longer matches the last approved snapshot."}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status-dependent content */}
      {(campaign.status === "draft" || campaign.status === "internal_review") && (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted p-3 mb-4">
              <Clock className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-medium text-foreground mb-1">Campaign is being prepared</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Our team is setting up your campaign. You&apos;ll be notified when it&apos;s ready for review.
            </p>
          </CardContent>
        </Card>
      )}

      {isPendingApproval && (
        <div>
          {activeStep === "leads" && (
            campaign.leadsApproved ? (
              /* Reviewing approved leads — green surround, read-only */
              <Card className="border-emerald-200/50 dark:border-emerald-800/50 bg-emerald-50/20 dark:bg-emerald-950/20">
                <CardContent className="pt-5">
                  <CampaignApprovalLeads
                    campaignId={campaign.id}
                    leads={leadSample?.leads ?? []}
                    totalCount={leadSample?.totalCount ?? 0}
                    leadsApproved={campaign.leadsApproved}
                    leadsFeedback={campaign.leadsFeedback}
                    isPending={campaign.status === "pending_approval"}
                  />
                </CardContent>
              </Card>
            ) : (
              <CampaignApprovalLeads
                campaignId={campaign.id}
                leads={leadSample?.leads ?? []}
                totalCount={leadSample?.totalCount ?? 0}
                leadsApproved={campaign.leadsApproved}
                leadsFeedback={campaign.leadsFeedback}
                isPending={campaign.status === "pending_approval"}
              />
            )
          )}

          {activeStep === "content" && (
            <CampaignApprovalContent
              campaignId={campaign.id}
              emailSequence={campaign.emailSequence as unknown[] | null}
              linkedinSequence={campaign.linkedinSequence as unknown[] | null}
              channels={campaign.channels}
              contentApproved={campaign.contentApproved}
              contentFeedback={campaign.contentFeedback}
              isPending={campaign.status === "pending_approval"}
              ebSequenceSteps={ebSequenceStepsForApproval}
            />
          )}
        </div>
      )}

      {campaign.status === "approved" && (
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-brand/10 p-3 mb-4">
              <CheckCircle2 className="h-6 w-6 text-brand" />
            </div>
            <h2 className="text-lg font-medium text-foreground mb-1">Campaign Approved!</h2>
            <p className="text-sm text-muted-foreground max-w-md mb-8">
              Our team will deploy your campaign shortly. You&apos;ll be notified when it goes live.
            </p>
            {/* Timeline */}
            <div className="flex items-center gap-0 text-sm">
              <div className="flex items-center gap-1.5 text-brand font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Approved
              </div>
              <div className="mx-3 h-0.5 w-10 rounded-full bg-border" />
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse" />
                Deploying
              </div>
              <div className="mx-3 h-0.5 w-10 rounded-full bg-border" />
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <div className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                Live
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {hasPerformanceData && (
        <CampaignDetailTabs
          metrics={metrics}
          sequenceSteps={sequenceSteps}
          chartData={chartData}
          campaignId={campaign.id}
          campaignChannels={campaign.channels}
          replies={replies.map((r) => ({
            ...r,
            receivedAt: r.receivedAt.toISOString(),
          }))}
        />
      )}

    </div>
  );
}
