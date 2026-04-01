/**
 * Reply Analysis CLI Script
 *
 * Runs the full analysis pipeline: gather data, synthesize insights via LLM,
 * write to memory files and DB.
 *
 * Usage:
 *   npx tsx scripts/run-reply-analysis.ts                    # full run
 *   npx tsx scripts/run-reply-analysis.ts --dry-run           # data only, no LLM
 *   npx tsx scripts/run-reply-analysis.ts --week-comparison   # include previous week comparison
 */

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "@prisma/client";
import {
  analyzeWorkspace,
  analyzeCrossWorkspace,
  synthesizeInsights,
  type WorkspaceAnalysis,
} from "../src/lib/reply-analysis";
import {
  appendToMemory,
  appendToGlobalMemory,
} from "../src/lib/agents/memory";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const weekComparison = process.argv.includes("--week-comparison");

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== FULL ANALYSIS RUN ===");
  if (weekComparison) console.log("Week comparison enabled");

  // 1. Find all workspaces with replies
  const workspaceGroups = await prisma.reply.groupBy({
    by: ["workspaceSlug"],
    _count: true,
  });

  console.log(`\nFound ${workspaceGroups.length} workspaces with replies\n`);

  // 2. Gather per-workspace data
  const workspaceResults = new Map<string, WorkspaceAnalysis>();

  for (const ws of workspaceGroups) {
    const slug = ws.workspaceSlug;
    console.log(`--- ${slug} (${ws._count} replies) ---`);

    const data = await analyzeWorkspace(slug);
    workspaceResults.set(slug, data);

    // Print summary
    const topCampaign = data.campaignBreakdown[0];
    const sentimentSummary = data.sentimentDistribution
      .map((s) => `${s.sentiment ?? "unclassified"}: ${s.count}`)
      .join(", ");

    console.log(`  Total replies: ${data.totalReplies}`);
    console.log(
      `  Top campaign: ${topCampaign?.campaignName ?? topCampaign?.campaignId ?? "none"} (${topCampaign?.replyCount ?? 0} replies)`,
    );
    console.log(`  Sentiment: ${sentimentSummary}`);
  }

  // 3. Cross-workspace analysis
  console.log("\n--- Cross-Workspace Analysis ---");
  const crossData = await analyzeCrossWorkspace();

  console.log(`  Workspaces: ${crossData.workspaceStats.length}`);
  console.log(`  Strategy data points: ${crossData.strategyPerformance.length}`);
  console.log(
    `  Subject length (positive avg): ${crossData.subjectLengthCorrelation.positive.avgWordCount} words (n=${crossData.subjectLengthCorrelation.positive.sampleSize})`,
  );
  console.log(
    `  Subject length (negative avg): ${crossData.subjectLengthCorrelation.negative.avgWordCount} words (n=${crossData.subjectLengthCorrelation.negative.sampleSize})`,
  );

  // 4. Dry run stops here
  if (dryRun) {
    console.log("\n=== RAW DATA ===\n");

    for (const [slug, data] of workspaceResults) {
      console.log(`\n[${slug}]`);
      console.log(JSON.stringify(data, null, 2));
    }

    console.log("\n[cross-workspace]");
    console.log(JSON.stringify(crossData, null, 2));

    console.log(
      `\nDRY RUN: ${workspaceResults.size} workspaces analyzed, ${Array.from(workspaceResults.values()).reduce((s, d) => s + d.totalReplies, 0)} total replies. Skipping LLM synthesis and memory writes.`,
    );
    await prisma.$disconnect();
    process.exit(0);
  }

  // 5. Synthesize insights per workspace and write to memory + DB
  const allGlobalInsights = new Set<string>();
  let totalWorkspaceInsights = 0;

  for (const [slug, wsData] of workspaceResults) {
    console.log(`\nSynthesizing insights for ${slug}...`);

    const { globalInsights, workspaceInsights } = await synthesizeInsights(
      wsData,
      crossData,
      slug,
    );

    // Write workspace insights to campaigns.md
    let wsWritten = 0;
    for (const insight of workspaceInsights) {
      const written = await appendToMemory(slug, "campaigns.md", insight);
      if (written) wsWritten++;
    }
    totalWorkspaceInsights += wsWritten;
    console.log(
      `  ${slug}: ${wsWritten}/${workspaceInsights.length} workspace insights written`,
    );

    // Collect global insights (deduplicate across workspaces)
    for (const insight of globalInsights) {
      allGlobalInsights.add(insight);
    }

    // Store in Insight DB table for sync script / Trigger.dev access
    const dedupKey = `weekly_analysis:${slug}:${new Date().toISOString().slice(0, 10)}`;
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

  // 6. Write global insights
  let globalWritten = 0;
  for (const insight of allGlobalInsights) {
    const written = await appendToGlobalMemory(insight);
    if (written) globalWritten++;
  }

  // 7. Final report
  console.log("\n=== ANALYSIS COMPLETE ===");
  console.log(`Workspaces analyzed: ${workspaceResults.size}`);
  console.log(
    `Global insights: ${globalWritten}/${allGlobalInsights.size} written to global-insights.md`,
  );
  console.log(
    `Workspace insights: ${totalWorkspaceInsights} written across all workspaces`,
  );
  console.log(`DB records: ${workspaceResults.size} Insight rows created`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Analysis failed:", err);
  await prisma.$disconnect();
  process.exit(1);
});
