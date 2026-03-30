/**
 * search-aiark.ts
 *
 * CLI wrapper: search AI Ark for people matching ICP filters.
 * Usage: node dist/cli/search-aiark.js <workspaceSlug> <jsonFile>
 *
 * JSON file format: { "jobTitles": [...], "seniority": [...], "industries": [...], ... }
 * COSTS CREDITS (~$0.003/call). Returns identity data only.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";
import { validateDiscoveryFilters } from "@/lib/discovery/validation";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("search-aiark <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as Record<string, unknown>;

  const validation = validateDiscoveryFilters("aiark", params);
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

  return leadsTools.searchAiArk.execute({ workspaceSlug, ...params } as Parameters<typeof leadsTools.searchAiArk.execute>[0]);
});
