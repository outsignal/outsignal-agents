import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { generateInsights } from "@/lib/insights/generate";
import { notifyWeeklyDigest, notifyWeeklyDigestBundled } from "@/lib/notifications";
import { anthropicQueue } from "./queues";
import { progressWarmup } from "@/lib/linkedin/rate-limiter";
import { updateAcceptanceRate } from "@/lib/linkedin/sender";
import { recoverStuckActions, expireStaleActions } from "@/lib/linkedin/queue";

// PrismaClient at module scope — not inside run()
const prisma = new PrismaClient();

/** Digest data returned per workspace for bundled email */
type WorkspaceDigestData = {
  workspaceName: string;
  workspaceSlug: string;
  topInsights: Array<{ observation: string; category: string; confidence: string }>;
  bestCampaign: { name: string; replyRate: number } | null;
  worstCampaign: { name: string; replyRate: number } | null;
  pendingActions: number;
  replyCount?: number;
  avgReplyRate?: number;
  insightCount?: number;
};

/**
 * Gather digest data for a workspace, send Slack notification (per-workspace),
 * and return the digest data for the bundled email.
 */
async function sendDigestForWorkspace(workspaceSlug: string): Promise<WorkspaceDigestData | null> {
  try {
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { name: true, slug: true },
    });
    if (!workspace) return null;

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

    // Reply count for the past 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const replyCount = await prisma.reply.count({
      where: {
        workspaceSlug,
        createdAt: { gte: sevenDaysAgo },
      },
    });

    // Compute avg reply rate from campaigns
    let avgReplyRate: number | undefined;
    if (campaigns.length > 0) {
      const totalRate = campaigns.reduce((sum, c) => sum + c.replyRate, 0);
      avgReplyRate = Math.round((totalRate / campaigns.length) * 10) / 10;
    }

    const digestData: WorkspaceDigestData = {
      workspaceName: workspace.name,
      workspaceSlug,
      topInsights,
      bestCampaign,
      worstCampaign,
      pendingActions,
      replyCount,
      avgReplyRate,
      insightCount: pendingActions,
    };

    // Send Slack notification per-workspace (email is now bundled separately)
    await notifyWeeklyDigest({
      workspaceSlug,
      topInsights,
      bestCampaign,
      worstCampaign,
      pendingActions,
      replyCount,
      avgReplyRate,
      insightCount: pendingActions,
    });

    return digestData;
  } catch (err) {
    console.error(
      `[generate-insights] Digest notification failed for ${workspaceSlug}:`,
      err,
    );
    return null;
  }
}

export const generateInsightsTask = schedules.task({
  id: "generate-insights",
  cron: "0 8 * * *", // daily at 08:00 UTC
  queue: anthropicQueue,
  maxDuration: 300, // 5 min — all workspaces with AI insight generation
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    const workspaces = await prisma.workspace.findMany({
      select: { slug: true },
    });

    console.log(
      `[generate-insights] Processing ${workspaces.length} workspaces`,
    );

    // Fan out across all workspaces in parallel — per-workspace error isolation
    // Insight generation and digest are independent: AI failures must not block digest emails
    const results = await Promise.all(
      workspaces.map(async (ws) => {
        let count = 0;
        let insightError: string | undefined;
        try {
          count = await generateInsights(ws.slug);
        } catch (err) {
          insightError = err instanceof Error ? err.message : String(err);
          console.error(`[generate-insights] Insight generation failed for ${ws.slug}:`, err);
        }

        let digestData: WorkspaceDigestData | null = null;
        try {
          digestData = await sendDigestForWorkspace(ws.slug);
        } catch (err) {
          console.error(`[generate-insights] Digest failed for ${ws.slug}:`, err);
        }

        return {
          workspace: ws.slug,
          insightsGenerated: count,
          digestData,
          ...(insightError ? { error: insightError } : {}),
        };
      }),
    );

    const totalInsights = results.reduce((s, r) => s + r.insightsGenerated, 0);
    const errors = results.filter((r) => "error" in r && r.error);

    console.log(
      `[generate-insights] Step 1 complete: ${totalInsights} total insights, ${errors.length} workspace errors`,
    );

    // Send bundled email digest (one email with all workspaces)
    const allDigestData = results
      .map((r) => r.digestData)
      .filter((d): d is WorkspaceDigestData => d != null);

    if (allDigestData.length > 0) {
      try {
        await notifyWeeklyDigestBundled(allDigestData);
        console.log(
          `[generate-insights] Bundled digest email sent for ${allDigestData.length} workspaces`,
        );
      } catch (err) {
        console.error("[generate-insights] Bundled digest email failed:", err);
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: LinkedIn maintenance (merged from inbox-linkedin-maintenance)
    // Runs every 6h alongside insights — warmup progression, acceptance rates,
    // stuck/stale action recovery.
    // -----------------------------------------------------------------------
    console.log(`[generate-insights] Step 2: LinkedIn maintenance`);

    const activeSenders = await prisma.sender.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
    });

    let warmupProcessed = 0;
    let warmupErrors = 0;

    // Sequential per-sender loop — safe default, per-sender DB queries
    for (const sender of activeSenders) {
      try {
        await progressWarmup(sender.id);
        warmupProcessed++;
      } catch (err) {
        warmupErrors++;
        console.error(`[generate-insights] progressWarmup failed for ${sender.name}:`, err);
      }
      try {
        await updateAcceptanceRate(sender.id);
      } catch (err) {
        console.error(`[generate-insights] updateAcceptanceRate failed for ${sender.name}:`, err);
      }
    }

    const stuckRecovered = await recoverStuckActions();
    const staleExpired = await expireStaleActions();

    console.log(
      `[generate-insights] Step 2 complete: warmup=${warmupProcessed}/${activeSenders.length}, errors=${warmupErrors}, stuck=${stuckRecovered}, expired=${staleExpired}`,
    );

    return {
      workspacesProcessed: workspaces.length,
      totalInsightsGenerated: totalInsights,
      digestsSent: workspaces.length - errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
      linkedinMaintenance: {
        warmupProcessed,
        warmupErrors,
        stuckRecovered,
        staleExpired,
        totalSenders: activeSenders.length,
      },
    };
  },
});
