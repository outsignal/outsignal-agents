/**
 * workspace-list.ts
 *
 * CLI wrapper: list all workspaces with name, slug, status.
 * Usage: node dist/cli/workspace-list.js
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { orchestratorTools } from "@/lib/agents/orchestrator";

runWithHarness("workspace-list", async () => {
  return orchestratorTools.listWorkspaces.execute({});
});
