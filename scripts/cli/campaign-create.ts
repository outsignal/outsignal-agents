/**
 * campaign-create.ts
 *
 * CLI wrapper script: create a new campaign for a workspace.
 * Usage: node dist/cli/campaign-create.js <workspaceSlug> <jsonFile>
 *
 * The JSON file should contain:
 * {
 *   "name": "Campaign Name",
 *   "description": "...",          // optional
 *   "channels": ["email"],         // optional, defaults to ["email"]
 *   "targetListId": "..."          // optional
 * }
 *
 * Enforces package/module gating and campaign allowance soft limit.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { campaignTools } from "@/lib/agents/campaign";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("campaign-create <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8"));
  return campaignTools.createCampaign.execute({ workspaceSlug, ...params });
});
