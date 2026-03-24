/**
 * kb-search.ts
 *
 * CLI wrapper script: search the Outsignal knowledge base.
 * Usage: node dist/cli/kb-search.js <query> [tags] [limit]
 *
 * Shared script used by writer, leads, and orchestrator agents.
 * Returns semantically relevant passages from the KB.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { searchKnowledgeBase } from "@/lib/agents/shared-tools";

const [, , query, tags, limitStr] = process.argv;
const limit = limitStr ? parseInt(limitStr, 10) : 10;

runWithHarness("kb-search <query> [tags] [limit]", async () => {
  if (!query) throw new Error("Missing required argument: query");
  return searchKnowledgeBase.execute({ query, tags, limit });
});
