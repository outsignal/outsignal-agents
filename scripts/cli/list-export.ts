/**
 * list-export.ts
 *
 * CLI wrapper: export verified leads from a target list to EmailBison.
 * Usage: node dist/cli/list-export.js <listId> <workspaceSlug>
 *
 * COSTS CREDITS for verification. Only exports people with verified emails.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , listId, workspaceSlug] = process.argv;

runWithHarness("list-export <listId> <workspaceSlug>", async () => {
  if (!listId) throw new Error("Missing required argument: listId");
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  return leadsTools.exportListToEmailBison.execute({ listId, workspaceSlug });
});
