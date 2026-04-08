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
import { SequenceStepsDisplay } from "@/components/portal/sequence-steps-display";
import type { LinkedInSequenceStep } from "@/components/portal/sequence-steps-display";
import { CampaignLeadsTable } from "@/components/portal/campaign-leads-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Users, ListOrdered, MessageSquare, Linkedin, Activity } from "lucide-react";
import type { Campaign as EBCampaign, SequenceStep } from "@/lib/emailbison/types";
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

interface LinkedInStats {
  totalActions: number;
  connectionsSent: number;
  messagesCompleted: number;
  profileViews: number;
  pendingActions: number;
}

interface CampaignDetailTabsProps {
  // Stats tab
  ebCampaign: EBCampaign | null;
  chartData: EmailActivityPoint[];
  openTracking: boolean;
  // Leads tab
  campaignId: string;
  ebCampaignId: number | null;
  // Sequence tab
  sequenceSteps: SequenceStep[];
  // Replies tab
  replies: ReplyItem[];
  // Status context
  hasPerformanceData: boolean;
  // LinkedIn
  linkedInStats?: LinkedInStats | null;
  linkedinSequence?: unknown[] | null;
  isLinkedInOnly?: boolean;
}

// ---------------------------------------------------------------------------
// LinkedIn Leads Table — shows all people assigned to the campaign (target list)
// ---------------------------------------------------------------------------

interface LinkedInLeadRow {
  id: string;
  personId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  company: string | null;
  linkedinUrl: string | null;
  status: "pending" | "contacted" | "connected" | "replied";
  addedAt: string;
}

const LEAD_STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  contacted: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  connected: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  replied: "bg-brand/10 text-brand",
};

function LinkedInLeadsTable({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<LinkedInLeadRow[]>([]);
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

  // Status summary counts
  const counts = { pending: 0, contacted: 0, connected: 0, replied: 0 };
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;

  return (
    <div className="space-y-4">
      {/* Status summary */}
      <div className="flex flex-wrap gap-3 text-sm">
        {(["pending", "contacted", "connected", "replied"] as const).map((s) => (
          <span key={s} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${LEAD_STATUS_STYLES[s]}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}: {counts[s]}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Title / Company</th>
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const name =
                [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email || "Unknown";
              const titleCompany = [row.jobTitle, row.company].filter(Boolean).join(" · ");
              return (
                <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{titleCompany || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${LEAD_STATUS_STYLES[row.status]}`}>
                      {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LinkedIn Activity Table — shows executed actions (profile views, connection requests, messages)
// ---------------------------------------------------------------------------

interface LinkedInActivityRow {
  id: string;
  actionType: string;
  status: string;
  completedAt: string | null;
  scheduledFor: string;
  createdAt: string;
  person: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    jobTitle: string | null;
    company: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Email Activity Table — shows email events from WebhookEvent table
// ---------------------------------------------------------------------------

interface EmailActivityRow {
  id: string;
  eventType: string;
  leadEmail: string | null;
  receivedAt: string;
  person: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    jobTitle: string | null;
    company: string | null;
  } | null;
}

const EMAIL_EVENT_STYLES: Record<string, string> = {
  EMAIL_SENT: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  EMAIL_OPENED: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  LEAD_REPLIED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  LEAD_INTERESTED: "bg-brand/10 text-brand",
  EMAIL_BOUNCED: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  LEAD_UNSUBSCRIBED: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

const EMAIL_EVENT_LABELS: Record<string, string> = {
  EMAIL_SENT: "Sent",
  EMAIL_OPENED: "Opened",
  LEAD_REPLIED: "Replied",
  LEAD_INTERESTED: "Interested",
  EMAIL_BOUNCED: "Bounced",
  LEAD_UNSUBSCRIBED: "Unsubscribed",
};

function EmailActivityTable({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<EmailActivityRow[]>([]);
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
        No email events recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Person</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Title / Company</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Event</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = row.person
              ? [row.person.firstName, row.person.lastName].filter(Boolean).join(" ") || row.leadEmail || "Unknown"
              : row.leadEmail || "Unknown";
            const titleCompany = row.person
              ? [row.person.jobTitle, row.person.company].filter(Boolean).join(" · ")
              : null;
            const date = new Date(row.receivedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const eventLabel = EMAIL_EVENT_LABELS[row.eventType] ?? row.eventType;
            const eventStyle = EMAIL_EVENT_STYLES[row.eventType] ?? "bg-muted text-muted-foreground";
            return (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                <td className="px-4 py-3 text-muted-foreground">{titleCompany || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${eventStyle}`}>
                    {eventLabel}
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

function LinkedInActivityTable({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<LinkedInActivityRow[]>([]);
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
        No LinkedIn actions recorded yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Person</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Title / Company</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Action</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = row.person
              ? [row.person.firstName, row.person.lastName].filter(Boolean).join(" ") || row.person.email || "Unknown"
              : "Unknown";
            const titleCompany = row.person
              ? [row.person.jobTitle, row.person.company].filter(Boolean).join(" · ")
              : null;
            const date = row.completedAt
              ? new Date(row.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : row.status === "pending" || row.status === "running"
              ? `Scheduled ${new Date(row.scheduledFor).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : "—";
            return (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{name}</td>
                <td className="px-4 py-3 text-muted-foreground">{titleCompany ?? "—"}</td>
                <td className="px-4 py-3 capitalize text-foreground">{row.actionType.replace(/_/g, " ")}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.status === "complete"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : row.status === "failed" || row.status === "cancelled"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {row.status}
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

const VALID_TABS = ["stats", "leads", "sequence", "replies", "activity"] as const;
type TabValue = (typeof VALID_TABS)[number];

function pct(numerator: number, denominator: number) {
  return denominator > 0 ? ((numerator / denominator) * 100).toFixed(1) : "0.0";
}

export function CampaignDetailTabs({
  ebCampaign,
  chartData,
  openTracking,
  campaignId,
  ebCampaignId,
  sequenceSteps,
  replies,
  hasPerformanceData,
  linkedInStats,
  linkedinSequence,
  isLinkedInOnly,
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

      {/* Stats Tab */}
      <TabsContent value="stats" className="pt-6">
        {ebCampaign ? (
          <div className="space-y-6">
            {(() => {
              const sent = ebCampaign.emails_sent;
              const bounceRate =
                sent > 0 ? (ebCampaign.bounced / sent) * 100 : 0;
              const interestedRate =
                sent > 0 ? (ebCampaign.interested / sent) * 100 : 0;
              const replyRate =
                sent > 0 ? (ebCampaign.unique_replies / sent) * 100 : 0;
              const unsubRate =
                sent > 0 ? (ebCampaign.unsubscribed / sent) * 100 : 0;

              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Row 1 */}
                  <MetricCard
                    label="Emails Sent"
                    value={sent.toLocaleString()}
                    icon="Send"
                    density="compact"
                  />
                  <MetricCard
                    label="People Contacted"
                    value={ebCampaign.total_leads_contacted.toLocaleString()}
                    icon="Users"
                    density="compact"
                  />
                  <MetricCard
                    label="Opens"
                    value={ebCampaign.opened.toLocaleString()}
                    detail={`${pct(ebCampaign.opened, sent)}%`}
                    trend="neutral"
                    icon="Eye"
                    density="compact"
                  />
                  <MetricCard
                    label="Unique Opens"
                    value={ebCampaign.unique_opens.toLocaleString()}
                    detail={`${pct(ebCampaign.unique_opens, sent)}%`}
                    trend="neutral"
                    icon="Eye"
                    density="compact"
                  />
                  {/* Row 2 */}
                  <MetricCard
                    label="Unique Replies"
                    value={ebCampaign.unique_replies.toLocaleString()}
                    detail={`${replyRate.toFixed(2)}%`}
                    trend="up"
                    icon="MessageSquare"
                    density="compact"
                  />
                  <MetricCard
                    label="Unsubscribed"
                    value={ebCampaign.unsubscribed.toLocaleString()}
                    detail={`${unsubRate.toFixed(2)}%`}
                    trend={unsubRate > 0 ? "warning" : "up"}
                    icon="UserMinus"
                    density="compact"
                  />
                  <MetricCard
                    label="Bounced"
                    value={ebCampaign.bounced.toLocaleString()}
                    detail={`${bounceRate.toFixed(2)}%`}
                    trend={bounceRate > 2 ? "warning" : "up"}
                    icon="AlertTriangle"
                    density="compact"
                  />
                  <MetricCard
                    label="Interested"
                    value={ebCampaign.interested.toLocaleString()}
                    detail={`${interestedRate.toFixed(2)}%`}
                    trend="up"
                    icon="Sparkles"
                    density="compact"
                  />
                </div>
              );
            })()}

            {/* Email Activity Chart */}
            {chartData.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-heading">
                      Email Activity (Last 30 Days)
                    </CardTitle>
                    <EmailActivityChartLegend
                      keys={[
                        "sent",
                        "replied",
                      ]}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <EmailActivityChart data={chartData} height={260} />
                </CardContent>
              </Card>
            )}
          </div>
        ) : isLinkedInOnly && linkedInStats ? (
          /* LinkedIn-only stats */
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <MetricCard
                label="Connections Sent"
                value={linkedInStats.connectionsSent.toLocaleString()}
                icon="UserPlus"
                density="compact"
              />
              <MetricCard
                label="Messages Sent"
                value={linkedInStats.messagesCompleted.toLocaleString()}
                icon="MessageSquare"
                density="compact"
              />
              <MetricCard
                label="Profile Views"
                value={linkedInStats.profileViews.toLocaleString()}
                icon="Eye"
                density="compact"
              />
              <MetricCard
                label="Total Actions"
                value={linkedInStats.totalActions.toLocaleString()}
                icon="Activity"
                density="compact"
              />
              <MetricCard
                label="Pending Actions"
                value={linkedInStats.pendingActions.toLocaleString()}
                trend={linkedInStats.pendingActions > 0 ? "neutral" : "up"}
                icon="Zap"
                density="compact"
              />
            </div>

            {/* LinkedIn Activity Chart (connections + messages by day) */}
            {chartData.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-heading flex items-center gap-2">
                      <Linkedin className="h-4 w-4" />
                      LinkedIn Activity (Last 30 Days)
                    </CardTitle>
                    <EmailActivityChartLegend
                      keys={["sent", "replied"]}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <EmailActivityChart data={chartData} height={260} />
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Performance data will appear once the campaign is active.
          </div>
        )}
      </TabsContent>

      {/* Leads Tab */}
      <TabsContent value="leads" className="pt-6">
        {hasPerformanceData && ebCampaignId ? (
          <CampaignLeadsTable
            campaignId={campaignId}
            ebCampaignId={ebCampaignId}
          />
        ) : hasPerformanceData && isLinkedInOnly ? (
          <LinkedInLeadsTable campaignId={campaignId} />
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Lead data will appear once the campaign is deployed and active.
          </div>
        )}
      </TabsContent>

      {/* Sequence Tab */}
      <TabsContent value="sequence" className="pt-6">
        {sequenceSteps.length > 0 ? (
          <SequenceStepsDisplay steps={sequenceSteps} />
        ) : linkedinSequence && linkedinSequence.length > 0 ? (
          <SequenceStepsDisplay linkedinSteps={linkedinSequence as LinkedInSequenceStep[]} />
        ) : (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            No sequence steps available.
          </div>
        )}
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

      {/* Activity Tab — LinkedIn: executed actions, Email: webhook events */}
      <TabsContent value="activity" className="pt-6">
        {isLinkedInOnly ? (
          <LinkedInActivityTable campaignId={campaignId} />
        ) : (
          <EmailActivityTable campaignId={campaignId} />
        )}
      </TabsContent>
    </Tabs>
  );
}
