/**
 * sequence-steps.ts
 *
 * CLI wrapper script: get email/LinkedIn sequence steps for a campaign.
 * Usage: node dist/cli/sequence-steps.js <workspaceSlug> <campaignId>
 *
 * Returns the actual copy (subject lines, body text) from an existing
 * EmailBison campaign sequence. Used by the Writer agent to study prior copy.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { writerTools } from "@/lib/agents/writer";

const [, , workspaceSlug, campaignIdStr] = process.argv;
const campaignId = campaignIdStr ? parseInt(campaignIdStr, 10) : undefined;

runWithHarness("sequence-steps <workspaceSlug> <campaignId>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!campaignId) throw new Error("Missing required argument: campaignId");
  return writerTools.getSequenceSteps.execute({ workspaceSlug, campaignId });
});
