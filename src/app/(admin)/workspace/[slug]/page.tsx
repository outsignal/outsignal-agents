import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getWorkspaceBySlug, getWorkspaceDetails } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import type { Campaign, Reply } from "@/lib/emailbison/types";
import { ApiTokenForm } from "@/components/settings/api-token-form";
import { Settings } from "lucide-react";

interface WorkspacePageProps {
  params: Promise<{ slug: string }>;
}

export default async function WorkspacePage({ params }: WorkspacePageProps) {
  const { slug } = await params;

  // Try to get the active workspace config (with API token)
  const workspace = await getWorkspaceBySlug(slug);

  // If no active config, check if it's a pending workspace in DB
  if (!workspace) {
    const details = await getWorkspaceDetails(slug);
    if (!details) notFound();

    return <PendingWorkspaceView details={details} />;
  }

  const client = new EmailBisonClient(workspace.apiToken);

  let campaigns: Campaign[] = [];
  let replies: Reply[] = [];
  let error: string | null = null;

  try {
    [campaigns, replies] = await Promise.all([
      client.getCampaigns(),
      client.getReplies(),
    ]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to fetch data";
  }

  const totalSent = campaigns.reduce(
    (sum, c) => sum + (c.emails_sent ?? 0),
    0,
  );
  const totalOpens = campaigns.reduce(
    (sum, c) => sum + (c.unique_opens ?? 0),
    0,
  );
  const totalReplies = campaigns.reduce(
    (sum, c) => sum + (c.replied ?? 0),
    0,
  );
  const totalBounces = campaigns.reduce(
    (sum, c) => sum + (c.bounced ?? 0),
    0,
  );

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    paused: "bg-yellow-100 text-yellow-800",
    draft: "bg-gray-100 text-gray-800",
    completed: "bg-blue-100 text-blue-800",
  };

  return (
    <div>
      <Header
        title={workspace.name}
        description={
          workspace.vertical ? `Vertical: ${workspace.vertical}` : undefined
        }
        actions={
          <Link
            href={`/workspace/${slug}/settings`}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        }
      />
      <div className="p-8 space-y-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Total Sent" value={totalSent.toLocaleString()} />
          <MetricCard
            label="Open Rate"
            value={`${totalSent > 0 ? ((totalOpens / totalSent) * 100).toFixed(1) : 0}%`}
          />
          <MetricCard
            label="Reply Rate"
            value={`${totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1) : 0}%`}
            trend={
              totalSent > 0 && (totalReplies / totalSent) * 100 > 3
                ? "up"
                : "neutral"
            }
          />
          <MetricCard
            label="Bounce Rate"
            value={`${totalSent > 0 ? ((totalBounces / totalSent) * 100).toFixed(1) : 0}%`}
            trend={
              totalSent > 0 && (totalBounces / totalSent) * 100 > 5
                ? "warning"
                : "neutral"
            }
          />
        </div>

        <Tabs defaultValue="campaigns">
          <TabsList>
            <TabsTrigger value="campaigns">
              Campaigns ({campaigns.length})
            </TabsTrigger>
            <TabsTrigger value="replies">
              Replies ({replies.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns">
            <Card>
              <CardHeader>
                <CardTitle className="font-heading">Campaigns</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Opens</TableHead>
                      <TableHead className="text-right">Replies</TableHead>
                      <TableHead className="text-right">Bounces</TableHead>
                      <TableHead className="text-right">Reply Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((campaign) => {
                      const sent = campaign.emails_sent ?? 0;
                      const rRate =
                        sent > 0
                          ? ((campaign.replied / sent) * 100).toFixed(1)
                          : "0.0";
                      return (
                        <TableRow key={campaign.id}>
                          <TableCell>
                            <Link
                              href={`/workspace/${slug}/campaigns/${campaign.id}`}
                              className="font-medium hover:underline"
                            >
                              {campaign.name}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={`text-xs ${statusColors[campaign.status] ?? ""}`}
                            >
                              {campaign.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {campaign.total_leads.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {sent.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {campaign.unique_opens.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {campaign.replied.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {campaign.bounced.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {rRate}%
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {campaigns.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No campaigns found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="replies">
            <Card>
              <CardHeader>
                <CardTitle className="font-heading">Replies</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {replies.slice(0, 50).map((reply) => (
                      <TableRow key={reply.id}>
                        <TableCell className="font-medium">
                          {reply.subject ?? "(No subject)"}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className={`text-xs ${reply.folder === "Bounced" ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}
                          >
                            {reply.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(reply.date_received).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                    {replies.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="text-center py-8 text-muted-foreground"
                        >
                          No replies yet
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// Pending workspace view — shows onboarding data and setup checklist
function PendingWorkspaceView({
  details,
}: {
  details: {
    slug: string;
    name: string;
    vertical: string | null;
    status: string;
    slackChannelId: string | null;
    notificationEmails: string | null;
    senderFullName: string | null;
    senderJobTitle: string | null;
    icpCountries: string | null;
    icpIndustries: string | null;
    icpCompanySize: string | null;
    icpDecisionMakerTitles: string | null;
    coreOffers: string | null;
    painPoints: string | null;
    differentiators: string | null;
    leadMagnets: string | null;
    website: string | null;
    senderEmailDomains: string | null;
    targetVolume: string | null;
  };
}) {
  const domains = details.senderEmailDomains
    ? JSON.parse(details.senderEmailDomains)
    : [];

  return (
    <div>
      <Header
        title={details.name}
        description={
          details.vertical ? `Vertical: ${details.vertical}` : "Pending setup"
        }
        actions={
          <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-800">
            {details.status === "pending_emailbison"
              ? "Pending Email Bison"
              : details.status}
          </Badge>
        }
      />
      <div className="p-8 space-y-6 max-w-4xl">
        {/* Setup Checklist */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Setup Checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChecklistItem
              done={true}
              label="Onboarding form completed"
            />
            <ChecklistItem
              done={!!details.slackChannelId}
              label="Slack channel created"
            />
            <ChecklistItem
              done={!!details.notificationEmails}
              label="Email notifications configured"
            />
            <ChecklistItem
              done={false}
              label="Email Bison workspace created + API token added"
            />
            <div className="pt-2">
              <p className="text-sm text-muted-foreground mb-2">
                Add the Email Bison API token to activate this workspace:
              </p>
              <ApiTokenForm slug={details.slug} />
            </div>
          </CardContent>
        </Card>

        {/* Onboarding Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">Onboarding Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <SummaryField label="Sender" value={`${details.senderFullName ?? "-"}${details.senderJobTitle ? `, ${details.senderJobTitle}` : ""}`} />
              <SummaryField label="Website" value={details.website} />
              <SummaryField label="ICP Countries" value={details.icpCountries} />
              <SummaryField label="ICP Industries" value={details.icpIndustries} />
              <SummaryField label="Company Size" value={details.icpCompanySize} />
              <SummaryField label="Decision Makers" value={details.icpDecisionMakerTitles} />
              <SummaryField label="Core Offers" value={details.coreOffers} />
              <SummaryField label="Pain Points" value={details.painPoints} />
              <SummaryField label="Differentiators" value={details.differentiators} />
              <SummaryField label="Lead Magnets" value={details.leadMagnets} />
              <SummaryField label="Target Volume" value={details.targetVolume} />
              {domains.length > 0 && (
                <div>
                  <p className="font-medium text-muted-foreground mb-1">
                    Selected Domains
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {domains.map((d: string) => (
                      <Badge key={d} variant="secondary" className="text-xs">
                        {d}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${done ? "border-emerald-500 bg-emerald-500" : "border-muted-foreground/30"}`}
      >
        {done && (
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </div>
      <span
        className={`text-sm ${done ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </div>
  );
}

function SummaryField({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div>
      <p className="font-medium text-muted-foreground mb-1">{label}</p>
      <p className="whitespace-pre-wrap">{value}</p>
    </div>
  );
}
