/**
 * campaign-get.ts
 *
 * CLI wrapper script: get full details of a Campaign entity by ID.
 * Usage: node dist/cli/campaign-get.js <campaignId>
 *
 * Returns Campaign with sequences, target list info, and approval status.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { campaignTools } from "@/lib/agents/campaign";

const [, , campaignId] = process.argv;

runWithHarness("campaign-get <campaignId>", async () => {
  if (!campaignId) throw new Error("Missing required argument: campaignId");
  return campaignTools.getCampaign.execute({ campaignId });
});
