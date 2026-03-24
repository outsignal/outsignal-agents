/**
 * sender-health.ts
 *
 * CLI wrapper: get inbox health for a workspace (send/reply/bounce stats per inbox).
 * Usage: node dist/cli/sender-health.js <workspaceSlug>
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { orchestratorTools } from "@/lib/agents/orchestrator";

const [, , workspaceSlug] = process.argv;

runWithHarness("sender-health <workspaceSlug>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  return orchestratorTools.getSenderHealth.execute({ workspaceSlug });
});
