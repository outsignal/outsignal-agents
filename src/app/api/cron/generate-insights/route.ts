import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { generateInsights } from "@/lib/insights/generate";
import { notifyWeeklyDigest } from "@/lib/notifications";

export const maxDuration = 60;

/**
 * Gather digest data for a workspace and send the weekly digest notification.
 */
async function sendDigestForWorkspace(workspaceSlug: string): Promise<void> {
  try {
    // Top 3 active insights by priority
    const topInsights = await prisma.insight.findMany({
      where: { workspaceSlug, status: "active" },
      orderBy: [{ priority: "asc" }, { generatedAt: "desc" }],
      take: 3,
      select: { observation: true, category: true, confidence: true },
    });

    // Best/worst campaign from latest campaign_snapshot
    const snapshots = await prisma.cachedMetrics.findMany({
      where: {
        workspace: workspaceSlug,
        metricType: "campaign_snapshot",
      },
      orderBy: { computedAt: "desc" },
    });

    // Get latest snapshot per campaign
    const latestByCampaign = new Map<
      string,
      { name: string; replyRate: number }
    >();
    for (const s of snapshots) {
      try {
        const data = JSON.parse(s.data) as {
          campaignName: string;
          replyRate: number;
        };
        if (!latestByCampaign.has(data.campaignName)) {
          latestByCampaign.set(data.campaignName, {
            name: data.campaignName,
            replyRate: data.replyRate,
          });
        }
      } catch {
        // skip unparseable
      }
    }

    const campaigns = Array.from(latestByCampaign.values());
    let bestCampaign: { name: string; replyRate: number } | null = null;
    let worstCampaign: { name: string; replyRate: number } | null = null;

    if (campaigns.length > 0) {
      campaigns.sort((a, b) => b.replyRate - a.replyRate);
      bestCampaign = campaigns[0];
      worstCampaign =
        campaigns.length > 1 ? campaigns[campaigns.length - 1] : null;
    }

    // Count all active insights for pending actions
    const pendingActions = await prisma.insight.count({
      where: { workspaceSlug, status: "active" },
    });

    await notifyWeeklyDigest({
      workspaceSlug,
      topInsights,
      bestCampaign,
      worstCampaign,
      pendingActions,
    });
  } catch (err) {
    console.error(
      `[generate-insights] Digest notification failed for ${workspaceSlug}:`,
      err,
    );
  }
}

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = new URL(request.url).searchParams.get("workspace");

  try {
    if (workspace) {
      // Single workspace mode (recommended: one cron-job.org entry per workspace)
      const count = await generateInsights(workspace);

      // Send weekly digest after generation
      await sendDigestForWorkspace(workspace);

      return NextResponse.json({
        ok: true,
        workspace,
        insightsGenerated: count,
        digestSent: true,
        timestamp: new Date().toISOString(),
      });
    }

    // All workspaces mode (iterate sequentially)
    const workspaces = await prisma.workspace.findMany({
      select: { slug: true },
    });

    const results: Array<{
      workspace: string;
      insightsGenerated: number;
      error?: string;
    }> = [];

    for (const ws of workspaces) {
      try {
        const count = await generateInsights(ws.slug);
        results.push({ workspace: ws.slug, insightsGenerated: count });

        // Send digest after each workspace's generation
        await sendDigestForWorkspace(ws.slug);
      } catch (err) {
        results.push({
          workspace: ws.slug,
          insightsGenerated: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const totalInsights = results.reduce(
      (s, r) => s + r.insightsGenerated,
      0,
    );
    const errors = results.filter((r) => r.error);

    return NextResponse.json({
      ok: true,
      workspacesProcessed: workspaces.length,
      totalInsightsGenerated: totalInsights,
      digestsSent: workspaces.length - errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[generate-insights] Unhandled error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
