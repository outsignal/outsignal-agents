import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getEnabledChannels } from '@/lib/channels/workspace-channels';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { slug: true, name: true, package: true },
  });

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const enabledChannels = getEnabledChannels(workspace.package ?? 'email');

  // Fetch all channel-prefixed CachedMetrics rows for this workspace (latest date per campaign)
  const allRows = await prisma.cachedMetrics.findMany({
    where: {
      workspace: slug,
      metricType: 'campaign_snapshot',
      metricKey: {
        // Matches both 'email:{name}' and 'linkedin:{name}' formats
        contains: ':',
      },
    },
    orderBy: { date: 'desc' },
    distinct: ['metricKey'],  // one row per campaign per channel (latest date wins)
  });

  // Aggregate per channel
  const channelAgg: Record<string, {
    channel: string;
    totalSent: number;
    totalReplied: number;
    campaignCount: number;
    // email extras
    totalOpened?: number;
    totalBounced?: number;
    // linkedin extras
    totalConnectionsSent?: number;
    totalConnectionsAccepted?: number;
    totalMessagesSent?: number;
    campaigns: Array<{ name: string; sent: number; replied: number; replyRate: number; status: string }>;
  }> = {};

  for (const row of allRows) {
    // Determine channel from key prefix
    const colonIdx = row.metricKey.indexOf(':');
    if (colonIdx === -1) continue; // skip non-prefixed rows (backwards compat rows)
    const channel = row.metricKey.slice(0, colonIdx);
    if (!enabledChannels.includes(channel as 'email' | 'linkedin')) continue;

    const data = JSON.parse(row.data) as Record<string, unknown>;
    const sent = (data.sent as number) ?? 0;
    const replied = (data.replied as number) ?? 0;
    const replyRate = (data.replyRate as number) ?? 0;
    const campaignName = (data.campaignName as string) ?? row.metricKey.slice(colonIdx + 1);
    const status = (data.status as string) ?? 'unknown';

    if (!channelAgg[channel]) {
      channelAgg[channel] = { channel, totalSent: 0, totalReplied: 0, campaignCount: 0, campaigns: [] };
    }
    const agg = channelAgg[channel];
    agg.totalSent += sent;
    agg.totalReplied += replied;
    agg.campaignCount += 1;
    agg.campaigns.push({ name: campaignName, sent, replied, replyRate, status });

    // Email extras
    if (channel === 'email') {
      agg.totalOpened = (agg.totalOpened ?? 0) + ((data.opened as number) ?? 0);
      agg.totalBounced = (agg.totalBounced ?? 0) + ((data.bounced as number) ?? 0);
    }
    // LinkedIn extras
    if (channel === 'linkedin') {
      agg.totalConnectionsSent = (agg.totalConnectionsSent ?? 0) + ((data.connectionsSent as number) ?? 0);
      agg.totalConnectionsAccepted = (agg.totalConnectionsAccepted ?? 0) + ((data.connectionsAccepted as number) ?? 0);
      agg.totalMessagesSent = (agg.totalMessagesSent ?? 0) + ((data.messagesSent as number) ?? 0);
    }
  }

  // Compute rates
  const channelResults = Object.values(channelAgg).map((agg) => ({
    ...agg,
    replyRate: agg.totalSent > 0 ? Math.round((agg.totalReplied / agg.totalSent) * 10000) / 100 : 0,
    openRate: agg.channel === 'email' && agg.totalSent > 0
      ? Math.round(((agg.totalOpened ?? 0) / agg.totalSent) * 10000) / 100
      : undefined,
    bounceRate: agg.channel === 'email' && agg.totalSent > 0
      ? Math.round(((agg.totalBounced ?? 0) / agg.totalSent) * 10000) / 100
      : undefined,
    acceptRate: agg.channel === 'linkedin' && (agg.totalConnectionsSent ?? 0) > 0
      ? Math.round(((agg.totalConnectionsAccepted ?? 0) / (agg.totalConnectionsSent ?? 1)) * 10000) / 100
      : undefined,
  }));

  return NextResponse.json({
    workspace: { slug: workspace.slug, name: workspace.name },
    enabledChannels,
    channels: channelResults,
  });
}
