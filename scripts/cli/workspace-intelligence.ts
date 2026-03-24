/**
 * workspace-intelligence.ts
 *
 * CLI wrapper script: get full workspace intelligence for a given slug.
 * Usage: node dist/cli/workspace-intelligence.js <slug>
 *
 * Returns workspace ICP, campaign brief, tone guidance, normalization rules,
 * and the latest website analysis. Used by the Writer agent before writing copy.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { writerTools } from "@/lib/agents/writer";

const [, , slug] = process.argv;

runWithHarness("workspace-intelligence <slug>", async () => {
  if (!slug) throw new Error("Missing required argument: slug");
  return writerTools.getWorkspaceIntelligence.execute({ slug });
});
