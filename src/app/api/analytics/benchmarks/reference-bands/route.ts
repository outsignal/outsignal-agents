import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import {
  INDUSTRY_BENCHMARKS,
  DEFAULT_BENCHMARKS,
  LINKEDIN_BENCHMARKS,
  type VerticalBenchmarks,
} from "@/lib/analytics/industry-benchmarks";

export const dynamic = "force-dynamic";

interface CampaignSnapshot {
  emailsSent: number;
  opened: number;
  replied: number;
  bounced: number;
  interested: number;
  linkedinConnectionsSent: number;
  linkedinConnectionsAccepted: number;
  linkedinMessagesSent: number;
  replyRate: number;
  openRate: number;
  bounceRate: number;
  interestedRate: number;
  campaignName: string;
  channels: string[];
}

interface WorkspaceAgg {
  slug: string;
  name: string;
  vertical: string | null;
  activeChannels: Set<string>;
  totalSent: number;
  totalOpened: number;
  totalReplied: number;
  totalBounced: number;
  totalInterested: number;
  totalLinkedinConnSent: number;
  totalLinkedinConnAccepted: number;
  totalLinkedinMsgSent: number;
}

export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const workspaceFilter = searchParams.get("workspace") || undefined;

  // Fetch all campaign snapshots
  const rows = await prisma.cachedMetrics.findMany({
    where: { metricType: "campaign_snapshot" },
    orderBy: { date: "desc" },
  });

  if (rows.length === 0) {
    return NextResponse.json({
      workspaces: [],
      globalAvg: null,
      message: "No campaign data yet",
    });
  }

  // Deduplicate to latest snapshot per campaign (metricKey)
  const latestPerCampaign = new Map<
    string,
    { workspace: string; data: CampaignSnapshot }
  >();
  for (const row of rows) {
    if (!latestPerCampaign.has(row.metricKey)) {
      try {
        const parsed = JSON.parse(row.data) as CampaignSnapshot;
        latestPerCampaign.set(row.metricKey, {
          workspace: row.workspace,
          data: parsed,
        });
      } catch {
        // Skip malformed rows
      }
    }
  }

  // Fetch workspaces for names and verticals
  const workspaces = await prisma.workspace.findMany({
    select: { slug: true, name: true, vertical: true },
  });
  const workspaceMap = new Map(workspaces.map((w) => [w.slug, w]));

  // Aggregate per workspace
  const aggMap = new Map<string, WorkspaceAgg>();

  for (const [, { workspace: ws, data }] of latestPerCampaign) {
    const emailSent = data.emailsSent || 0;
    const linkedinConnSent = data.linkedinConnectionsSent || 0;
    const linkedinMsgSent = data.linkedinMessagesSent || 0;
    const totalSent = emailSent + linkedinConnSent + linkedinMsgSent;
    if (totalSent < 10) continue;

    if (!aggMap.has(ws)) {
      const wsInfo = workspaceMap.get(ws);
      aggMap.set(ws, {
        slug: ws,
        name: wsInfo?.name || ws,
        vertical: wsInfo?.vertical || null,
        activeChannels: new Set<string>(),
        totalSent: 0,
        totalOpened: 0,
        totalReplied: 0,
        totalBounced: 0,
        totalInterested: 0,
        totalLinkedinConnSent: 0,
        totalLinkedinConnAccepted: 0,
        totalLinkedinMsgSent: 0,
      });
    }

    const agg = aggMap.get(ws)!;

    // Determine active channels from campaign data
    const channels: string[] = Array.isArray(data.channels)
      ? data.channels
      : [];
    for (const ch of channels) {
      agg.activeChannels.add(ch);
    }

    // If no channels field, infer from data
    if (channels.length === 0) {
      if (emailSent > 0) agg.activeChannels.add("email");
      if (linkedinConnSent > 0 || linkedinMsgSent > 0)
        agg.activeChannels.add("linkedin");
    }

    agg.totalSent += emailSent;
    agg.totalOpened += data.opened || 0;
    agg.totalReplied += data.replied || 0;
    agg.totalBounced += data.bounced || 0;
    agg.totalInterested += data.interested || 0;
    agg.totalLinkedinConnSent += linkedinConnSent;
    agg.totalLinkedinConnAccepted += data.linkedinConnectionsAccepted || 0;
    agg.totalLinkedinMsgSent += linkedinMsgSent;
  }

  // Compute rates and build response
  function computeRates(agg: WorkspaceAgg) {
    const emailMetrics = {
      replyRate: agg.totalSent > 0
        ? Math.round((agg.totalReplied / agg.totalSent) * 10000) / 100
        : 0,
      openRate: agg.totalSent > 0
        ? Math.round((agg.totalOpened / agg.totalSent) * 10000) / 100
        : 0,
      bounceRate: agg.totalSent > 0
        ? Math.round((agg.totalBounced / agg.totalSent) * 10000) / 100
        : 0,
      interestedRate: agg.totalSent > 0
        ? Math.round((agg.totalInterested / agg.totalSent) * 10000) / 100
        : 0,
    };
    return emailMetrics;
  }

  // Build workspace responses
  const workspaceResults: Array<{
    slug: string;
    name: string;
    vertical: string | null;
    activeChannels: ("email" | "linkedin")[];
    metrics: {
      replyRate: number;
      openRate: number;
      bounceRate: number;
      interestedRate: number;
    };
    industryBenchmark: VerticalBenchmarks;
  }> = [];

  for (const [, agg] of aggMap) {
    if (workspaceFilter && agg.slug !== workspaceFilter) continue;

    const metrics = computeRates(agg);
    const channels = Array.from(agg.activeChannels) as ("email" | "linkedin")[];

    // Look up industry benchmark by workspace vertical
    const benchmark: VerticalBenchmarks = {
      ...(agg.vertical && INDUSTRY_BENCHMARKS[agg.vertical]
        ? INDUSTRY_BENCHMARKS[agg.vertical]
        : DEFAULT_BENCHMARKS),
    };

    // Add LinkedIn benchmarks if workspace has LinkedIn campaigns
    if (channels.includes("linkedin")) {
      benchmark.connectionAcceptRate = LINKEDIN_BENCHMARKS.connectionAcceptRate;
      benchmark.messageReplyRate = LINKEDIN_BENCHMARKS.messageReplyRate;
    }

    workspaceResults.push({
      slug: agg.slug,
      name: agg.name,
      vertical: agg.vertical,
      activeChannels: channels,
      metrics,
      industryBenchmark: benchmark,
    });
  }

  // Compute global averages across all workspaces (not filtered)
  let globalTotalSent = 0;
  let globalTotalOpened = 0;
  let globalTotalReplied = 0;
  let globalTotalBounced = 0;
  let globalTotalInterested = 0;

  for (const [, agg] of aggMap) {
    globalTotalSent += agg.totalSent;
    globalTotalOpened += agg.totalOpened;
    globalTotalReplied += agg.totalReplied;
    globalTotalBounced += agg.totalBounced;
    globalTotalInterested += agg.totalInterested;
  }

  const globalAvg = globalTotalSent > 0
    ? {
        replyRate:
          Math.round((globalTotalReplied / globalTotalSent) * 10000) / 100,
        openRate:
          Math.round((globalTotalOpened / globalTotalSent) * 10000) / 100,
        bounceRate:
          Math.round((globalTotalBounced / globalTotalSent) * 10000) / 100,
        interestedRate:
          Math.round((globalTotalInterested / globalTotalSent) * 10000) / 100,
      }
    : null;

  return NextResponse.json({
    workspaces: workspaceResults,
    globalAvg,
  });
}
