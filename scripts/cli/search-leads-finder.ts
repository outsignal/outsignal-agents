/**
 * search-leads-finder.ts
 *
 * CLI wrapper: search Apify Leads Finder for people matching ICP filters.
 * Usage: node dist/cli/search-leads-finder.js <workspaceSlug> <jsonFile>
 *
 * JSON file format: { "jobTitles": [...], "seniority": [...], "limit": 100, ... }
 * Returns VERIFIED EMAILS + phones + LinkedIn in one step. ~$2/1K leads.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("search-leads-finder <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as Record<string, unknown>;
  return leadsTools.searchLeadsFinder.execute({ workspaceSlug, ...params } as Parameters<typeof leadsTools.searchLeadsFinder.execute>[0]);
});
