/**
 * signal-campaign-activate.ts
 *
 * CLI wrapper script: activate a signal campaign.
 * Usage: node dist/cli/signal-campaign-activate.js <campaignId>
 *
 * Transitions campaign from draft to active. Requires at least one content
 * sequence (emailSequence or linkedinSequence). For email campaigns, this
 * pre-provisions an EmailBison campaign.
 *
 * Once active, the signal pipeline will automatically discover, score,
 * and deploy leads when matching signals fire.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { campaignTools } from "@/lib/agents/campaign";

const [, , campaignId] = process.argv;

runWithHarness("signal-campaign-activate <campaignId>", async () => {
  if (!campaignId) throw new Error("Missing required argument: campaignId");
  return campaignTools.activateSignalCampaign.execute({ campaignId });
});
