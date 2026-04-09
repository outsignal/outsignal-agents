import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/dashboard/metric-card';
import { Badge } from '@/components/ui/badge';

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceAnalyticsPage({ params }: Props) {
  const { slug } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/workspace/${slug}/channel-metrics`, {
    cache: 'no-store',
  });

  if (res.status === 404) notFound();

  const data = await res.json() as {
    workspace: { slug: string; name: string };
    enabledChannels: string[];
    channels: Array<{
      channel: string;
      totalSent: number;
      totalReplied: number;
      campaignCount: number;
      replyRate: number;
      openRate?: number;
      bounceRate?: number;
      acceptRate?: number;
      totalConnectionsSent?: number;
      totalConnectionsAccepted?: number;
      campaigns: Array<{ name: string; sent: number; replied: number; replyRate: number; status: string }>;
    }>;
  };

  const { channels } = data;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Channel Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Side-by-side performance comparison across active channels.
        </p>
      </div>

      {channels.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            No channel metrics yet. Metrics are collected nightly — check back after the next snapshot run.
          </CardContent>
        </Card>
      ) : (
        <div className={`grid gap-6 ${channels.length > 1 ? 'md:grid-cols-2' : 'md:grid-cols-1 max-w-lg'}`}>
          {channels.map((ch) => (
            <Card key={ch.channel}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base capitalize">
                    {ch.channel === 'email' ? 'Email' : 'LinkedIn'}
                  </CardTitle>
                  <Badge variant="outline" className="text-xs">
                    {ch.campaignCount} campaign{ch.campaignCount !== 1 ? 's' : ''}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <MetricCard label="Sent" value={ch.totalSent.toLocaleString()} density="compact" />
                  <MetricCard label="Replied" value={ch.totalReplied.toLocaleString()} density="compact" />
                  <MetricCard label="Reply Rate" value={`${ch.replyRate}%`} density="compact" />
                  {ch.openRate !== undefined && (
                    <MetricCard label="Open Rate" value={`${ch.openRate}%`} density="compact" />
                  )}
                  {ch.bounceRate !== undefined && (
                    <MetricCard label="Bounce Rate" value={`${ch.bounceRate}%`} density="compact" />
                  )}
                  {ch.acceptRate !== undefined && (
                    <MetricCard label="Accept Rate" value={`${ch.acceptRate}%`} density="compact" />
                  )}
                  {ch.totalConnectionsSent !== undefined && (
                    <MetricCard label="Connections Sent" value={(ch.totalConnectionsSent).toLocaleString()} density="compact" />
                  )}
                </div>

                {/* Per-campaign breakdown */}
                {ch.campaigns.length > 0 && (
                  <div className="space-y-1 mt-2">
                    <p className="text-xs text-muted-foreground font-medium mb-2">Per Campaign</p>
                    {ch.campaigns
                      .sort((a, b) => b.replyRate - a.replyRate)
                      .map((campaign) => (
                        <div key={campaign.name} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground truncate max-w-[180px]" title={campaign.name}>
                            {campaign.name}
                          </span>
                          <span className="font-medium tabular-nums">{campaign.replyRate}%</span>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Summary row when both channels present */}
      {channels.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-medium">Cross-Channel Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {channels.map((ch) => (
                <div key={ch.channel} className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {ch.channel === 'email' ? 'Email' : 'LinkedIn'}
                  </p>
                  <p className="text-xl font-semibold">{ch.replyRate}%</p>
                  <p className="text-xs text-muted-foreground">reply rate</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
