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
import { validateDiscoveryFilters } from "@/lib/discovery/validation";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("search-leads-finder <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as Record<string, unknown>;

  const validation = validateDiscoveryFilters("leads-finder", params);
  if (!validation.valid) {
    const blocks = validation.issues.filter(i => i.type === "hard-block");
    console.error(`\nBLOCKED (${blocks.length} issue${blocks.length > 1 ? "s" : ""}):`);
    for (const issue of blocks) {
      console.error(`  [${issue.check}] ${issue.message}`);
      console.error(`  Suggestion: ${issue.suggestion}`);
    }
    process.exit(1);
  }
  const warnings = validation.issues.filter(i => i.type === "warning");
  if (warnings.length) {
    console.warn(`\nWARNINGS (${warnings.length}):`);
    for (const w of warnings) {
      console.warn(`  [${w.check}] ${w.message}`);
    }
  }

  return leadsTools.searchLeadsFinder.execute({ workspaceSlug, ...params } as Parameters<typeof leadsTools.searchLeadsFinder.execute>[0]);
});
