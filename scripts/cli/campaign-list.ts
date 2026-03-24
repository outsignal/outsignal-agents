/**
 * campaign-list.ts
 *
 * CLI wrapper script: list all campaigns for a workspace.
 * Usage: node dist/cli/campaign-list.js <workspaceSlug>
 *
 * Returns all campaigns ordered by most recently updated.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { campaignTools } from "@/lib/agents/campaign";

const [, , workspaceSlug] = process.argv;

runWithHarness("campaign-list <workspaceSlug>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  return campaignTools.listCampaigns.execute({ workspaceSlug });
});
