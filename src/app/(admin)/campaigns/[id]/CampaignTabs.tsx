"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface CampaignTabsProps {
  overviewContent: React.ReactNode;
  leadsContent: React.ReactNode;
  sequenceContent: React.ReactNode;
  leadCount: number;
  emailStepCount: number;
  linkedinStepCount: number;
}

export function CampaignTabs({
  overviewContent,
  leadsContent,
  sequenceContent,
  leadCount,
  emailStepCount,
  linkedinStepCount,
}: CampaignTabsProps) {
  const totalSteps = emailStepCount + linkedinStepCount;

  return (
    <Tabs defaultValue="overview">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="leads">
          Leads
          {leadCount > 0 && (
            <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5 tabular-nums ml-1.5">
              {leadCount.toLocaleString()}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="content">
          Content
          {totalSteps > 0 && (
            <span className="text-[10px] bg-muted rounded-full px-1.5 py-0.5 tabular-nums ml-1.5">
              {totalSteps}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview">{overviewContent}</TabsContent>
      <TabsContent value="leads">{leadsContent}</TabsContent>
      <TabsContent value="content">{sequenceContent}</TabsContent>
    </Tabs>
  );
}
