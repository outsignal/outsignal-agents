/**
 * discovery-plan.ts
 *
 * CLI wrapper: build a discovery plan showing sources, cost, volume, and quota impact.
 * Usage: node dist/cli/discovery-plan.js <workspaceSlug> <jsonFile>
 *
 * JSON file format: { "sources": [{ "name": "apollo", "reasoning": "...", "estimatedVolume": 100, "filters": {} }] }
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("discovery-plan <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as { sources: Array<{ name: string; reasoning: string; estimatedVolume: number; filters: Record<string, unknown> }> };
  if (!params.sources) throw new Error("JSON file must contain sources array");
  return leadsTools.buildDiscoveryPlan.execute({ workspaceSlug, sources: params.sources as Parameters<typeof leadsTools.buildDiscoveryPlan.execute>[0]["sources"] });
});
