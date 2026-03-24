/**
 * list-score.ts
 *
 * CLI wrapper: score all unscored people in a target list against ICP criteria.
 * Usage: node dist/cli/list-score.js <listId> <workspaceSlug>
 *
 * COSTS CREDITS (Firecrawl + Claude Haiku per person).
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , listId, workspaceSlug] = process.argv;

runWithHarness("list-score <listId> <workspaceSlug>", async () => {
  if (!listId) throw new Error("Missing required argument: listId");
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  return leadsTools.scoreList.execute({ listId, workspaceSlug });
});
