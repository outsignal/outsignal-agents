/**
 * existing-drafts.ts
 *
 * CLI wrapper script: get existing email/LinkedIn drafts for a workspace.
 * Usage: node dist/cli/existing-drafts.js <workspaceSlug> [campaignName]
 *
 * Returns draft records from the database. Used by the Writer agent
 * to check for previous versions before writing or revising copy.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { writerTools } from "@/lib/agents/writer";

const [, , workspaceSlug, campaignName] = process.argv;

runWithHarness("existing-drafts <workspaceSlug> [campaignName]", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  return writerTools.getExistingDrafts.execute({ workspaceSlug, campaignName });
});
