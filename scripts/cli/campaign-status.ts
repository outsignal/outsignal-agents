/**
 * campaign-status.ts
 *
 * CLI wrapper script: transition a campaign to a new status.
 * Usage: node dist/cli/campaign-status.js <campaignId> <newStatus>
 *
 * Valid statuses: draft, internal_review, pending_approval, approved,
 *                 deployed, active, paused, completed
 *
 * Valid transitions:
 *   draft -> internal_review
 *   internal_review -> pending_approval | draft
 *   pending_approval -> approved | internal_review
 *   approved -> deployed
 *   deployed -> active
 *   active -> paused | completed
 *   paused -> active | completed
 *   any -> completed
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { campaignTools } from "@/lib/agents/campaign";

const [, , campaignId, newStatus] = process.argv;

runWithHarness("campaign-status <campaignId> <newStatus>", async () => {
  if (!campaignId) throw new Error("Missing required argument: campaignId");
  if (!newStatus) throw new Error("Missing required argument: newStatus");
  return campaignTools.updateCampaignStatus.execute({ campaignId, newStatus });
});
