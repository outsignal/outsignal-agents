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

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("search-aiark <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as Record<string, unknown>;
  return leadsTools.searchAiArk.execute({ workspaceSlug, ...params } as Parameters<typeof leadsTools.searchAiArk.execute>[0]);
});
