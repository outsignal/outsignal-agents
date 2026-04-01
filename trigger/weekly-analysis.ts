/**
 * Weekly Reply Analysis — Trigger.dev Scheduled Task
 *
 * Runs every Monday at 09:00 UTC (after generate-insights at 08:10).
 * Gathers per-workspace + cross-workspace reply data, synthesizes insights
 * via LLM, and stores results in the Insight DB table.
 *
 * NOTE: Trigger.dev runs remotely — cannot write to local .nova/memory/ files.
 * Run `npx tsx scripts/sync-insights-to-memory.ts` locally to pull DB insights
 * into memory files.
 */

import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import {
  analyzeWorkspace,
  analyzeCrossWorkspace,
  synthesizeInsights,
} from "@/lib/reply-analysis";
import { anthropicQueue } from "./queues";

const prisma = new PrismaClient();

export const weeklyAnalysis = schedules.task({
  id: "weekly-analysis",
  cron: "0 9 * * 1", // Monday 09:00 UTC
  queue: anthropicQueue,
  maxDuration: 120, // 2 min — analysis + LLM synthesis for ~6 workspaces
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
  },

  run: async () => {
    // 1. Get all workspaces with replies
    const workspaceGroups = await prisma.reply.groupBy({
      by: ["workspaceSlug"],
      _count: true,
    });

    console.log(
      `[weekly-analysis] Processing ${workspaceGroups.length} workspaces`,
    );

    // 2. Gather data for each workspace
    const workspaceResults = new Map<
      string,
      Awaited<ReturnType<typeof analyzeWorkspace>>
    >();

    for (const ws of workspaceGroups) {
      const data = await analyzeWorkspace(ws.workspaceSlug);
      workspaceResults.set(ws.workspaceSlug, data);
    }

    // 3. Cross-workspace analysis
    const crossData = await analyzeCrossWorkspace();

    // 4. Synthesize insights per workspace and store to DB
    // Trigger.dev runs remotely — store in Insight table, not local files.
    // User runs sync-insights-to-memory.ts locally to pull into .nova/memory/.
    const dateKey = new Date().toISOString().slice(0, 10);
    let totalInsights = 0;

    for (const [slug, wsData] of workspaceResults) {
      const { globalInsights, workspaceInsights } = await synthesizeInsights(
        wsData,
        crossData,
        slug,
      );

      totalInsights += globalInsights.length + workspaceInsights.length;

      const dedupKey = `weekly_analysis:${slug}:${dateKey}`;

      await prisma.insight.create({
        data: {
          workspaceSlug: slug,
          category: "performance",
          observation: `Weekly analysis: ${workspaceInsights.length} workspace insights, ${globalInsights.length} global insights`,
          evidence: JSON.stringify({
            globalInsights,
            workspaceInsights,
            totalReplies: wsData.totalReplies,
          }),
          confidence: "high",
          actionType: "flag_copy_review",
          actionDescription: `Review ${workspaceInsights.length} copy insights from weekly analysis`,
          dedupKey,
        },
      });
    }

    console.log(
      `[weekly-analysis] Complete: ${workspaceGroups.length} workspaces, ${totalInsights} total insights`,
    );

    return {
      workspacesAnalyzed: workspaceGroups.length,
      totalInsights,
      timestamp: new Date().toISOString(),
    };
  },
});
