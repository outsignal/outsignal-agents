/**
 * extract-directory.ts
 *
 * CLI wrapper: extract contacts from a directory URL via Firecrawl.
 * Usage: node dist/cli/extract-directory.js <workspaceSlug> <url>
 *
 * COSTS 1 CREDIT. Use after finding directory URLs via search-google.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , workspaceSlug, url] = process.argv;

runWithHarness("extract-directory <workspaceSlug> <url>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!url) throw new Error("Missing required argument: url");
  return leadsTools.extractDirectory.execute({ workspaceSlug, url });
});
