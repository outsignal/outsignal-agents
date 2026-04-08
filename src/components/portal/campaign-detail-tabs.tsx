"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  EmailActivityChart,
  EmailActivityChartLegend,
} from "@/components/charts/email-activity-chart";
import type { EmailActivityPoint } from "@/components/charts/email-activity-chart";
import { CampaignLeadsTable } from "@/components/portal/campaign-leads-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Users, ListOrdered, MessageSquare, Mail, Linkedin, Activity, ChevronDown, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { UnifiedMetrics, UnifiedStep } from "@/lib/channels/types";
import Link from "next/link";

interface ReplyItem {
  id: string;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  bodyText: string;
  receivedAt: string;
  intent: string | null;
  sentiment: string | null;
  emailBisonReplyId: number | null;
  emailBisonParentId: number | null;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

interface CampaignDetailTabsProps {
  // Unified metrics — one entry per channel
  metrics: UnifiedMetrics[];
  // Chart data — kept for EmailActivityChart (server-side bucketed)
  chartData: EmailActivityPoint[];
  // Sequence steps — unified across channels
  sequenceSteps: UnifiedStep[];
  // Campaign context
  campaignId: string;
  campaignChannels: string[];
  // Replies (channel-agnostic)
  replies: ReplyItem[];
}

// ---------------------------------------------------------------------------
// Unified Activity Table — shows actions from all channels (from API)
// ---------------------------------------------------------------------------

interface UnifiedActivityRow {
  id: string;
  channel: string;
  actionType: string;
  status: string;
  performedAt: string;
  personId?: string;
  personName?: string;
  personEmail?: string;
  detail?: string;
  campaignName?: string;
}

const ACTION_TYPE_STYLES: Record<string, string> = {
  reply: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  EMAIL_SENT: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  EMAIL_OPENED: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  LEAD_REPLIED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  LEAD_INTERESTED: "bg-brand/10 text-brand",
  EMAIL_BOUNCED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  LEAD_UNSUBSCRIBED: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  connection_request: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  connect: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  message: "bg-brand/10 text-brand",
  profile_view: "bg-muted text-muted-foreground",
};

function ActivityTable({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<UnifiedActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/portal/campaigns/${campaignId}/activity`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setRows(json.data);
        else setError("Failed to load activity");
      })
      .catch(() => setError("Failed to load activity"))
      .finally(() => setLoading(false));
  }, [campaignId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Loading activity...
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        No activity recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Person</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Channel</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Action</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = row.personName || row.personEmail || "Unknown";
            const date = new Date(row.performedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const actionLabel = row.actionType.replace(/_/g, " ");
            const actionStyle = ACTION_TYPE_STYLES[row.actionType] ?? "bg-muted text-muted-foreground";
            return (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize">
                  {row.channel === "email" ? (
                    <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> Email</span>
                  ) : (
                    <span className="inline-flex items-center gap-1"><Linkedin className="h-3 w-3" /> LinkedIn</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${actionStyle}`}>
                    {actionLabel}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{date}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified Leads Table — loads from adapter-backed API
// ---------------------------------------------------------------------------

interface UnifiedLeadRow {
  id: string;
  channel: string;
  email?: string;
  linkedInUrl?: string;
  name?: string;
  company?: string;
  title?: string;
  status: string;
  addedAt?: string;
}

const LEAD_STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  connected: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  replied: "bg-brand/10 text-brand",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  unsubscribed: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  bounced: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  unknown: "bg-muted text-muted-foreground",
};

function UnifiedLeadsTable({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<UnifiedLeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/portal/campaigns/${campaignId}/leads`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) setRows(json.data);
        else setError("Failed to load leads");
      })
      .catch(() => setError("Failed to load leads"))
      .finally(() => setLoading(false));
  }, [campaignId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Loading leads...
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        No leads assigned to this campaign yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Title / Company</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Channel</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = row.name || row.email || row.linkedInUrl || "Unknown";
            const titleCompany = [row.title, row.company].filter(Boolean).join(" · ");
            const statusStyle = LEAD_STATUS_STYLES[row.status] ?? "bg-muted text-muted-foreground";
            return (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                <td className="px-4 py-3 text-muted-foreground">{titleCompany || "—"}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize">
                  {row.channel === "email" ? (
                    <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> Email</span>
                  ) : (
                    <span className="inline-flex items-center gap-1"><Linkedin className="h-3 w-3" /> LinkedIn</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle}`}>
                    {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified Sequence Steps Display — renders from UnifiedStep[]
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags for plain-text display of email body content.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const STEP_TYPE_LABELS: Record<string, string> = {
  profile_view: "Profile View",
  connection_request: "Connection Request",
  connect: "Connection Request",
  message: "Message",
  follow_up: "Follow-up",
  email: "Email",
};

function UnifiedSequenceDisplay({ steps }: { steps: UnifiedStep[] }) {
  const [openStep, setOpenStep] = useState<number>(0);

  if (steps.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        No sequence steps available.
      </div>
    );
  }

  // Group by channel for multi-channel campaigns
  const channels = [...new Set(steps.map((s) => s.channel))];
  const multiChannel = channels.length > 1;

  const sorted = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);

  return (
    <div className="space-y-6">
      {channels.map((channel) => {
        const channelSteps = sorted.filter((s) => s.channel === channel);
        return (
          <div key={channel}>
            {multiChannel && (
              <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                {channel === "email" ? (
                  <><Mail className="h-4 w-4" /> Email Sequence ({channelSteps.length} steps)</>
                ) : (
                  <><Linkedin className="h-4 w-4" /> LinkedIn Sequence ({channelSteps.length} steps)</>
                )}
              </h3>
            )}
            {!multiChannel && (
              <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                {channel === "email" ? (
                  <><Mail className="h-4 w-4" /> Email Sequence ({channelSteps.length} steps)</>
                ) : (
                  <><Linkedin className="h-4 w-4" /> LinkedIn Sequence ({channelSteps.length} steps)</>
                )}
              </h3>
            )}
            <div className="space-y-2">
              {channelSteps.map((step, idx) => {
                const stepKey = `${channel}-${idx}`;
                const isOpen = openStep === idx && channels.indexOf(channel) === 0
                  || openStep === idx + 1000 * (channels.indexOf(channel));
                const label = STEP_TYPE_LABELS[step.type] ?? step.type.replace(/_/g, " ");
                const content = step.bodyHtml ? stripHtml(step.bodyHtml) : step.messageBody;

                return (
                  <div key={stepKey} className="border rounded-lg">
                    <button
                      onClick={() => setOpenStep(openStep === idx + 1000 * channels.indexOf(channel) ? -1 : idx + 1000 * channels.indexOf(channel))}
                      className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant="outline" className="shrink-0 text-xs tabular-nums">
                          Step {step.stepNumber}
                        </Badge>
                        <span className="font-medium text-sm truncate">
                          {step.subjectLine || label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        {step.delayDays > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {step.delayDays}d delay
                          </span>
                        )}
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 transition-transform text-muted-foreground",
                            isOpen && "rotate-180",
                          )}
                        />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 space-y-3 border-t">
                        {step.subjectLine && (
                          <div className="pt-3">
                            <p className="text-xs text-muted-foreground mb-1">Subject</p>
                            <p className="font-medium text-sm">{step.subjectLine}</p>
                          </div>
                        )}
                        {content && (
                          <div className={step.subjectLine ? "" : "pt-3"}>
                            <p className="text-xs text-muted-foreground mb-1">
                              {channel === "email" ? "Body" : "Message"}
                            </p>
                            <div className="whitespace-pre-wrap text-sm leading-relaxed bg-muted/30 rounded-md p-3">
                              {content}
                            </div>
                          </div>
                        )}
                        {!content && (
                          <div className="pt-3">
                            <p className="text-sm text-muted-foreground italic">
                              {step.type === "connection_request" || step.type === "connect"
                                ? "Blank connection request (no note)."
                                : "No content for this step."}
                            </p>
                          </div>
                        )}
                        {step.triggerEvent && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Trigger</p>
                            <p className="text-sm">{step.triggerEvent.replace(/_/g, " ")}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const VALID_TABS = ["stats", "leads", "sequence", "replies", "activity"] as const;
type TabValue = (typeof VALID_TABS)[number];

function pct(numerator: number, denominator: number) {
  return denominator > 0 ? ((numerator / denominator) * 100).toFixed(1) : "0.0";
}

export function CampaignDetailTabs({
  metrics,
  chartData,
  sequenceSteps,
  campaignId,
  campaignChannels,
  replies,
}: CampaignDetailTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawTab = searchParams.get("tab");
  const currentTab: TabValue =
    rawTab && VALID_TABS.includes(rawTab as TabValue)
      ? (rawTab as TabValue)
      : "stats";

  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  // For the leads tab — check if there's an email channel with an EB campaign
  // (to use CampaignLeadsTable which expects numeric ebCampaignId for richer EB data)
  // For now we use the unified leads table for all channels
  const hasEmailChannel = campaignChannels.includes("email");
  const hasLinkedInChannel = campaignChannels.includes("linkedin");

  return (
    <Tabs value={currentTab} onValueChange={handleTabChange}>
      <TabsList variant="line" className="w-full border-b">
        <TabsTrigger value="stats">
          <BarChart3 className="h-4 w-4" />
          Stats
        </TabsTrigger>
        <TabsTrigger value="leads">
          <Users className="h-4 w-4" />
          Leads
        </TabsTrigger>
        <TabsTrigger value="sequence">
          <ListOrdered className="h-4 w-4" />
          Sequence
        </TabsTrigger>
        <TabsTrigger value="replies">
          <MessageSquare className="h-4 w-4" />
          Replies
        </TabsTrigger>
        <TabsTrigger value="activity">
          <Activity className="h-4 w-4" />
          Activity
        </TabsTrigger>
      </TabsList>

      {/* Stats Tab — renders from UnifiedMetrics[] — one section per channel */}
      <TabsContent value="stats" className="pt-6">
        {metrics.length > 0 ? (
          <div className="space-y-8">
            {metrics.map((m) => (
              <div key={m.channel} className="space-y-4">
                {/* Channel label for multi-channel campaigns */}
                {metrics.length > 1 && (
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    {m.channel === "email" ? (
                      <><Mail className="h-3.5 w-3.5" /> Email</>
                    ) : (
                      <><Linkedin className="h-3.5 w-3.5" /> LinkedIn</>
                    )}
                  </p>
                )}

                {/* Email metrics */}
                {m.channel === "email" && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <MetricCard
                        label="Emails Sent"
                        value={m.sent.toLocaleString()}
                        icon="Send"
                        density="compact"
                      />
                      <MetricCard
                        label="Replies"
                        value={m.replied.toLocaleString()}
                        detail={`${(m.replyRate * 100).toFixed(2)}%`}
                        trend="up"
                        icon="MessageSquare"
                        density="compact"
                      />
                      {m.opened !== undefined && (
                        <MetricCard
                          label="Opens"
                          value={m.opened.toLocaleString()}
                          detail={`${pct(m.opened, m.sent)}%`}
                          trend="neutral"
                          icon="Eye"
                          density="compact"
                        />
                      )}
                      {m.bounced !== undefined && (
                        <MetricCard
                          label="Bounced"
                          value={m.bounced.toLocaleString()}
                          detail={`${(m.bounceRate ?? 0 * 100).toFixed(2)}%`}
                          trend={(m.bounceRate ?? 0) > 0.02 ? "warning" : "up"}
                          icon="AlertTriangle"
                          density="compact"
                        />
                      )}
                    </div>

                    {/* Email Activity Chart */}
                    {chartData.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-heading">
                              Email Activity (Last 30 Days)
                            </CardTitle>
                            <EmailActivityChartLegend keys={["sent", "replied"]} />
                          </div>
                        </CardHeader>
                        <CardContent>
                          <EmailActivityChart data={chartData} height={260} />
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}

                {/* LinkedIn metrics */}
                {m.channel === "linkedin" && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {m.connectionsSent !== undefined && (
                        <MetricCard
                          label="Connections Sent"
                          value={m.connectionsSent.toLocaleString()}
                          icon="UserPlus"
                          density="compact"
                        />
                      )}
                      {m.connectionsAccepted !== undefined && (
                        <MetricCard
                          label="Connections Accepted"
                          value={m.connectionsAccepted.toLocaleString()}
                          detail={m.acceptRate !== undefined ? `${(m.acceptRate * 100).toFixed(1)}%` : undefined}
                          trend="up"
                          icon="UserCheck"
                          density="compact"
                        />
                      )}
                      {m.messagesSent !== undefined && (
                        <MetricCard
                          label="Messages Sent"
                          value={m.messagesSent.toLocaleString()}
                          icon="MessageSquare"
                          density="compact"
                        />
                      )}
                      {m.profileViews !== undefined && (
                        <MetricCard
                          label="Profile Views"
                          value={m.profileViews.toLocaleString()}
                          icon="Eye"
                          density="compact"
                        />
                      )}
                      <MetricCard
                        label="Sent"
                        value={m.sent.toLocaleString()}
                        icon="Activity"
                        density="compact"
                      />
                    </div>

                    {/* LinkedIn Activity Chart (connections + messages by day) */}
                    {chartData.length > 0 && hasLinkedInChannel && !hasEmailChannel && (
                      <Card>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-heading flex items-center gap-2">
                              <Linkedin className="h-4 w-4" />
                              LinkedIn Activity (Last 30 Days)
                            </CardTitle>
                            <EmailActivityChartLegend keys={["sent", "replied"]} />
                          </div>
                        </CardHeader>
                        <CardContent>
                          <EmailActivityChart data={chartData} height={260} />
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Performance data will appear once the campaign is active.
          </div>
        )}
      </TabsContent>

      {/* Leads Tab — unified leads table (adapter-backed API) */}
      <TabsContent value="leads" className="pt-6">
        <UnifiedLeadsTable campaignId={campaignId} />
      </TabsContent>

      {/* Sequence Tab — unified sequence display from UnifiedStep[] */}
      <TabsContent value="sequence" className="pt-6">
        <UnifiedSequenceDisplay steps={sequenceSteps} />
      </TabsContent>

      {/* Replies Tab */}
      <TabsContent value="replies" className="pt-6">
        {replies.length > 0 ? (
          <div className="space-y-3">
            {replies.map((reply) => (
              <Link key={reply.id} href={`/portal/inbox${reply.emailBisonParentId ?? reply.emailBisonReplyId ? `?thread=${reply.emailBisonParentId ?? reply.emailBisonReplyId}` : ""}`} className="block">
                <Card className="cursor-pointer hover:shadow-md hover:bg-muted/30 transition-all">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-foreground truncate">
                            {reply.senderName || reply.senderEmail}
                          </span>
                          {reply.senderName && (
                            <span className="text-xs text-muted-foreground truncate">
                              {reply.senderEmail}
                            </span>
                          )}
                          {reply.intent && (
                            <StatusBadge status={reply.intent} type="intent" />
                          )}
                          {reply.sentiment && (
                            <StatusBadge status={reply.sentiment} type="sentiment" />
                          )}
                        </div>
                        {reply.subject && (
                          <p className="text-sm text-muted-foreground">
                            {reply.subject}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground/80 line-clamp-2">
                          {reply.bodyText.length > 150
                            ? reply.bodyText.slice(0, 150) + "..."
                            : reply.bodyText}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                        {timeAgo(reply.receivedAt)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            No replies yet for this campaign.
          </div>
        )}
      </TabsContent>

      {/* Activity Tab — unified activity (adapter-backed API) */}
      <TabsContent value="activity" className="pt-6">
        <ActivityTable campaignId={campaignId} />
      </TabsContent>
    </Tabs>
  );
}
