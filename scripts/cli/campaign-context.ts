/**
 * campaign-context.ts
 *
 * CLI wrapper script: get Campaign entity details including sequences and target list.
 * Usage: node dist/cli/campaign-context.js <campaignId>
 *
 * Returns Campaign entity with linked TargetList info, existing sequences,
 * and approval status. Used by the Writer agent when generating content
 * for a specific campaign.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { writerTools } from "@/lib/agents/writer";

const [, , campaignId] = process.argv;

runWithHarness("campaign-context <campaignId>", async () => {
  if (!campaignId) throw new Error("Missing required argument: campaignId");
  return writerTools.getCampaignContext.execute({ campaignId });
});
