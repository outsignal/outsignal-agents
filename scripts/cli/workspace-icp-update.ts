/**
 * workspace-icp-update.ts
 *
 * CLI wrapper script: update empty ICP/campaign brief fields on a workspace.
 * Usage: node dist/cli/workspace-icp-update.js <slug> <jsonFile>
 *
 * The JSON file should contain any subset of these optional fields:
 * {
 *   "vertical": "...",
 *   "icpCountries": "...",
 *   "icpIndustries": "...",
 *   "icpCompanySize": "...",
 *   "icpDecisionMakerTitles": "...",
 *   "icpKeywords": "...",
 *   "icpExclusionCriteria": "...",
 *   "coreOffers": "...",
 *   "differentiators": "...",
 *   "painPoints": "...",
 *   "pricingSalesCycle": "...",
 *   "caseStudies": "..."
 * }
 *
 * Only updates fields that are currently null/empty — never overwrites client-provided data.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { researchTools } from "@/lib/agents/research";

const [, , slug, jsonFile] = process.argv;

runWithHarness("workspace-icp-update <slug> <jsonFile>", async () => {
  if (!slug) throw new Error("Missing required argument: slug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8"));
  return researchTools.updateWorkspaceICP.execute({ slug, ...params });
});
