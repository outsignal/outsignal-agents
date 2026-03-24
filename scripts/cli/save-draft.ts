/**
 * save-draft.ts
 *
 * CLI wrapper script: save an email or LinkedIn draft to the database.
 * Usage: node dist/cli/save-draft.js <workspaceSlug> <jsonFile>
 *
 * The JSON file should contain:
 * {
 *   "campaignName": "...",
 *   "channel": "email" | "linkedin",
 *   "sequenceStep": 1,
 *   "bodyText": "...",
 *   "subjectLine": "...",      // optional (email only)
 *   "subjectVariantB": "...",  // optional
 *   "bodyHtml": "...",         // optional
 *   "delayDays": 1             // optional (default 1)
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

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("save-draft <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8"));
  return writerTools.saveDraft.execute({ workspaceSlug, ...params });
});
