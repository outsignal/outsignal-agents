/**
 * list-get-all.ts
 *
 * CLI wrapper: list all target lists, optionally filtered by workspace.
 * Usage: node dist/cli/list-get-all.js [workspaceSlug]
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , workspaceSlug] = process.argv;

runWithHarness("list-get-all [workspaceSlug]", async () => {
  return leadsTools.getLists.execute({ workspaceSlug: workspaceSlug || undefined });
});
