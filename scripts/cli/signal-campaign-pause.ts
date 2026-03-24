/**
 * signal-campaign-pause.ts
 *
 * CLI wrapper script: pause or resume a signal campaign.
 * Usage: node dist/cli/signal-campaign-pause.js <campaignId> <pause|resume>
 *
 * Pausing stops new signal matching but allows in-flight leads to complete
 * processing (graceful drain). Resuming immediately starts matching new signals.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { campaignTools } from "@/lib/agents/campaign";

const [, , campaignId, action] = process.argv;

runWithHarness("signal-campaign-pause <campaignId> <pause|resume>", async () => {
  if (!campaignId) throw new Error("Missing required argument: campaignId");
  if (!action) throw new Error("Missing required argument: action (pause|resume)");
  if (action !== "pause" && action !== "resume") {
    throw new Error(`Invalid action '${action}' — must be 'pause' or 'resume'`);
  }
  return campaignTools.pauseResumeSignalCampaign.execute({ campaignId, action });
});
