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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Users, ListOrdered, MessageSquare } from "lucide-react";
import type { Campaign as EBCampaign, SequenceStep } from "@/lib/emailbison/types";

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
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-heading">
                  Campaign Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(() => {
                  const sent = ebCampaign.emails_sent;
                  const trackingOff = !openTracking;
                  const bounceRate =
                    sent > 0 ? (ebCampaign.bounced / sent) * 100 : 0;
                  const interestedRate =
                    sent > 0 ? (ebCampaign.interested / sent) * 100 : 0;

                  return (
                    <>
                      {/* Row 1: High-volume metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <MetricCard
                          label="Emails Sent"
                          value={sent.toLocaleString()}
                          density="compact"
                        />
                        <MetricCard
                          label="People Contacted"
                          value={ebCampaign.total_leads_contacted.toLocaleString()}
                          density="compact"
                        />
                        <MetricCard
                          label="Total Opens"
                          value={
                            trackingOff
                              ? "N/A"
                              : ebCampaign.opened.toLocaleString()
                          }
                          density="compact"
                        />
                        <MetricCard
                          label="Unique Opens"
                          value={
                            trackingOff
                              ? "N/A"
                              : ebCampaign.unique_opens.toLocaleString()
                          }
                          detail={
                            trackingOff
                              ? "Tracking off"
                              : `${pct(ebCampaign.unique_opens, sent)}% of sent`
                          }
                          density="compact"
                        />
                      </div>
                      {/* Row 2: Outcome metrics */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <MetricCard
                          label="Unique Replies"
                          value={ebCampaign.unique_replies.toLocaleString()}
                          detail={`${pct(ebCampaign.unique_replies, sent)}% of sent`}
                          density="compact"
                        />
                        <MetricCard
                          label="Unsubscribed"
                          value={ebCampaign.unsubscribed.toLocaleString()}
                          detail={`${pct(ebCampaign.unsubscribed, sent)}% of sent`}
                          density="compact"
                        />
                        <MetricCard
                          label="Bounced"
                          value={ebCampaign.bounced.toLocaleString()}
                          detail={`${pct(ebCampaign.bounced, sent)}% of sent`}
                          trend={bounceRate > 5 ? "warning" : undefined}
                          density="compact"
                        />
                        <MetricCard
                          label="Interested"
                          value={ebCampaign.interested.toLocaleString()}
                          detail={`${pct(ebCampaign.interested, sent)}% of sent`}
                          trend={interestedRate > 0 ? "up" : undefined}
                          density="compact"
                        />
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>

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
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          Campaign replies coming soon.
        </div>
      </TabsContent>
    </Tabs>
  );
}
