/**
 * campaigns-get.ts
 *
 * CLI wrapper: get all campaigns for a workspace with performance metrics.
 * Usage: node dist/cli/campaigns-get.js <workspaceSlug>
 *
 * NOTE: This is the orchestrator's getCampaigns (EmailBison campaigns).
 * Different from campaign-list (which manages Outsignal Campaign entities).
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { orchestratorTools } from "@/lib/agents/orchestrator";

const [, , workspaceSlug] = process.argv;

runWithHarness("campaigns-get <workspaceSlug>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  return orchestratorTools.getCampaigns.execute({ workspaceSlug });
});
