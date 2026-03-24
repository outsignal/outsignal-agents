/**
 * search-apollo.ts
 *
 * CLI wrapper: search Apollo.io for people matching ICP filters.
 * Usage: node dist/cli/search-apollo.js <workspaceSlug> <jsonFile>
 *
 * JSON file format: { "jobTitles": [...], "seniority": [...], "industries": [...], ... }
 * Search is FREE (no credits). Returns identity data only.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("search-apollo <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as Record<string, unknown>;
  return leadsTools.searchApollo.execute({ workspaceSlug, ...params } as Parameters<typeof leadsTools.searchApollo.execute>[0]);
});
