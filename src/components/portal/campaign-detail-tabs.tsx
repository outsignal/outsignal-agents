"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
  EmailActivityChart,
  EmailActivityChartLegend,
} from "@/components/charts/email-activity-chart";
import type { EmailActivityPoint } from "@/components/charts/email-activity-chart";
import { SequenceStepsDisplay } from "@/components/portal/sequence-steps-display";
import { CampaignLeadsTable } from "@/components/portal/campaign-leads-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Users, ListOrdered, MessageSquare } from "lucide-react";
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
}

const VALID_TABS = ["stats", "leads", "sequence", "replies"] as const;
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
    </Tabs>
  );
}
