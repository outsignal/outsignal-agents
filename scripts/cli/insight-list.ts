/**
 * insight-list.ts
 *
 * CLI wrapper: list AI-generated insights for a workspace (or trigger generation).
 * Usage: node dist/cli/insight-list.js <workspaceSlug>
 *
 * Lists existing insights from the DB. Does NOT call generateInsights (that involves LLM cost).
 * To generate new insights, use the insight-generate script (future).
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";

const [, , workspaceSlug] = process.argv;

runWithHarness("insight-list <workspaceSlug>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");

  const insights = await prisma.insight.findMany({
    where: { workspaceSlug },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      category: true,
      observation: true,
      actionDescription: true,
      priority: true,
      status: true,
      createdAt: true,
    },
  });

  return {
    workspaceSlug,
    total: insights.length,
    insights: insights.map(i => ({
      id: i.id,
      category: i.category,
      observation: i.observation,
      actionDescription: i.actionDescription,
      priority: i.priority,
      status: i.status,
      createdAt: i.createdAt.toISOString(),
    })),
  };
});
