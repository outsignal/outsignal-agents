/**
 * target-list-find.ts
 *
 * CLI wrapper script: find target lists for a workspace.
 * Usage: node dist/cli/target-list-find.js <workspaceSlug> [nameFilter]
 *
 * Returns all target lists for the workspace. Optionally filter by name
 * (partial match, case-insensitive). Used to resolve list names to IDs
 * before creating campaigns.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { campaignTools } from "@/lib/agents/campaign";

const [, , workspaceSlug, nameFilter] = process.argv;

runWithHarness("target-list-find <workspaceSlug> [nameFilter]", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  return campaignTools.findTargetList.execute({ workspaceSlug, nameFilter });
});
