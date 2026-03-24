/**
 * cached-metrics.ts
 *
 * CLI wrapper: get pre-computed campaign metrics for a workspace from CachedMetrics.
 * Usage: node dist/cli/cached-metrics.js <workspaceSlug>
 *
 * Reads from CachedMetrics table (populated by daily snapshot-metrics cron).
 * Use snapshotWorkspaceCampaigns (via Trigger.dev cron) to refresh data.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";

const [, , workspaceSlug] = process.argv;

runWithHarness("cached-metrics <workspaceSlug>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");

  // Get the latest snapshot per campaign
  const latestByKey = await prisma.cachedMetrics.findMany({
    where: {
      workspace: workspaceSlug,
      metricType: "campaign_snapshot",
    },
    orderBy: { date: "desc" },
    distinct: ["metricKey"],
    take: 50,
    select: {
      metricKey: true,
      date: true,
      data: true,
    },
  });

  const campaigns = latestByKey.map(entry => {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(entry.data) as Record<string, unknown>;
    } catch {
      // skip unparseable entries
    }
    return {
      campaignId: entry.metricKey,
      date: entry.date,
      ...parsed,
    };
  });

  return {
    workspaceSlug,
    total: campaigns.length,
    campaigns,
  };
});
