/**
 * campaign-publish.ts
 *
 * CLI wrapper script: publish a campaign for client review.
 * Usage: node dist/cli/campaign-publish.js <campaignId>
 *
 * Transitions campaign to 'pending_approval' status.
 * Requires: campaign in 'internal_review' status, at least one sequence,
 * and a target list linked.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { campaignTools } from "@/lib/agents/campaign";

const [, , campaignId] = process.argv;

runWithHarness("campaign-publish <campaignId>", async () => {
  if (!campaignId) throw new Error("Missing required argument: campaignId");
  return campaignTools.publishForReview.execute({ campaignId });
});
