/**
 * campaign-performance.ts
 *
 * CLI wrapper script: get campaign performance metrics for a workspace.
 * Usage: node dist/cli/campaign-performance.js <workspaceSlug>
 *
 * Returns campaign metrics (reply rates, open rates, bounce rates)
 * pulled from EmailBison via the workspace API token.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { writerTools } from "@/lib/agents/writer";

const [, , workspaceSlug] = process.argv;

runWithHarness("campaign-performance <workspaceSlug>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  return writerTools.getCampaignPerformance.execute({ workspaceSlug });
});
