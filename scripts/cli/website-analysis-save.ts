/**
 * website-analysis-save.ts
 *
 * CLI wrapper script: save website analysis results to the database.
 * Usage: node dist/cli/website-analysis-save.js <workspaceSlug> <jsonFile>
 *
 * The JSON file should contain:
 * {
 *   "url": "https://example.com",
 *   "crawlData": "{...}",    // JSON string of raw crawl results
 *   "analysis": "{...}",     // JSON string of structured ResearchOutput
 *   "suggestions": "{...}"   // optional: JSON string of ICP enhancement suggestions
 * }
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { researchTools } from "@/lib/agents/research";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("website-analysis-save <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8"));
  return researchTools.saveWebsiteAnalysis.execute({ workspaceSlug, ...params });
});
