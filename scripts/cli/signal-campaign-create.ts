/**
 * signal-campaign-create.ts
 *
 * CLI wrapper script: create a signal campaign.
 * Usage: node dist/cli/signal-campaign-create.js <workspaceSlug> <jsonFile>
 *
 * The JSON file should contain:
 * {
 *   "name": "Rise Fintech Signals",
 *   "icpDescription": "SaaS companies, 50-200 employees in UK, targeting CEOs and CTOs",
 *   "signalTypes": ["job_change", "funding"],
 *   "channels": ["email"],       // optional, defaults to ["email"]
 *   "dailyLeadCap": 20,          // optional
 *   "icpScoreThreshold": 70      // optional
 * }
 *
 * Campaign created as draft — must generate content and activate before going live.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { campaignTools } from "@/lib/agents/campaign";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("signal-campaign-create <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8"));
  return campaignTools.createSignalCampaign.execute({ workspaceSlug, ...params });
});
