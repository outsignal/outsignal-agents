import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CampaignBarChart,
  CampaignPieChart,
} from "@/components/charts/campaign-chart";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";

interface CampaignDetailPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export default async function CampaignDetailPage({
  params,
}: CampaignDetailPageProps) {
  const { slug, id } = await params;
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) notFound();

  const client = new EmailBisonClient(workspace.apiToken);

  let campaigns;
  try {
    campaigns = await client.getCampaigns();
  } catch {
    notFound();
  }

  const campaign = campaigns.find((c) => c.id === Number(id));
  if (!campaign) notFound();

  const sent = campaign.emails_sent;
  const opens = campaign.unique_opens;
  const replies = campaign.replied;
  const bounces = campaign.bounced;
  const clicks = 0; // Not tracked by Email Bison
  const interested = campaign.interested;

  const barData = [
    { name: "Sent", value: sent },
    { name: "Opens", value: opens },
    { name: "Clicks", value: clicks },
    { name: "Replies", value: replies },
    { name: "Interested", value: interested },
    { name: "Bounces", value: bounces },
  ];

  const pieData = [
    { name: "Opened", value: Math.max(0, opens - replies) },
    { name: "Replied", value: replies },
    { name: "Bounced", value: bounces },
    { name: "No Open", value: Math.max(0, sent - opens - bounces) },
  ].filter((d) => d.value > 0);

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    paused: "bg-yellow-100 text-yellow-800",
    draft: "bg-gray-100 text-gray-800",
    completed: "bg-blue-100 text-blue-800",
  };

  return (
    <div>
      <Header
        title={campaign.name}
        description={`${workspace.name} campaign`}
        actions={
          <Badge className={`text-xs ${statusColors[campaign.status] ?? ""}`}>
            {campaign.status}
          </Badge>
        }
      />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard label="Sent" value={sent.toLocaleString()} />
          <MetricCard
            label="Open Rate"
            value={`${sent > 0 ? ((opens / sent) * 100).toFixed(1) : 0}%`}
          />
          <MetricCard
            label="Click Rate"
            value={`${sent > 0 ? ((clicks / sent) * 100).toFixed(1) : 0}%`}
          />
          <MetricCard
            label="Reply Rate"
            value={`${sent > 0 ? ((replies / sent) * 100).toFixed(1) : 0}%`}
            trend={sent > 0 && (replies / sent) * 100 > 3 ? "up" : "neutral"}
          />
          <MetricCard
            label="Interested"
            value={interested.toLocaleString()}
            trend={interested > 0 ? "up" : "neutral"}
          />
          <MetricCard
            label="Bounce Rate"
            value={`${sent > 0 ? ((bounces / sent) * 100).toFixed(1) : 0}%`}
            trend={sent > 0 && (bounces / sent) * 100 > 5 ? "warning" : "neutral"}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading">Campaign Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <CampaignBarChart data={barData} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-heading">
                Lead Status Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CampaignPieChart data={pieData} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
