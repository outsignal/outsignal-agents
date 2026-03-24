/**
 * save-sequence.ts
 *
 * CLI wrapper script: save email or LinkedIn sequence to a Campaign entity.
 * Usage: node dist/cli/save-sequence.js <campaignId> <jsonFile>
 *
 * The JSON file should contain:
 * {
 *   "emailSequence": [...],   // optional
 *   "linkedinSequence": [...], // optional
 *   "copyStrategy": "pvp"     // optional
 * }
 *
 * Applies copy quality gate — rejects banned patterns before saving.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { writerTools } from "@/lib/agents/writer";

const [, , campaignId, jsonFile] = process.argv;

runWithHarness("save-sequence <campaignId> <jsonFile>", async () => {
  if (!campaignId) throw new Error("Missing required argument: campaignId");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8"));
  return writerTools.saveCampaignSequence.execute({ campaignId, ...params });
});
