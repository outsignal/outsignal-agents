/**
 * discovery-promote.ts
 *
 * CLI wrapper: deduplicate staged leads and promote to Person DB.
 * Usage: node dist/cli/discovery-promote.js <workspaceSlug> <runId1> [runId2] [runId3...]
 *
 * Accepts variadic runIds (all args after workspaceSlug).
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , workspaceSlug, ...discoveryRunIds] = process.argv;

runWithHarness("discovery-promote <workspaceSlug> <runId1> [runId2...]", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (discoveryRunIds.length === 0) throw new Error("Missing required argument: at least one runId");
  return leadsTools.deduplicateAndPromote.execute({ workspaceSlug, discoveryRunIds });
});
