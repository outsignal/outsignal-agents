/**
 * replies-get.ts
 *
 * CLI wrapper: get recent email replies for a workspace.
 * Usage: node dist/cli/replies-get.js <workspaceSlug> [limit]
 *
 * Defaults to limit 20 to prevent context overflow.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { orchestratorTools } from "@/lib/agents/orchestrator";

const [, , workspaceSlug, limitStr] = process.argv;
const limit = limitStr ? parseInt(limitStr, 10) : 20;

runWithHarness("replies-get <workspaceSlug> [limit]", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  return orchestratorTools.getReplies.execute({ workspaceSlug, limit });
});
