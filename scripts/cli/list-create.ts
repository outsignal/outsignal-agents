/**
 * list-create.ts
 *
 * CLI wrapper: create a new target list for a workspace.
 * Usage: node dist/cli/list-create.js <workspaceSlug> <name>
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , workspaceSlug, name] = process.argv;

runWithHarness("list-create <workspaceSlug> <name>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!name) throw new Error("Missing required argument: name");
  return leadsTools.createList.execute({ workspaceSlug, name });
});
