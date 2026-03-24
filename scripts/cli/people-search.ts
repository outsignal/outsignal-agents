/**
 * people-search.ts
 *
 * CLI wrapper: search people in the database.
 * Usage: node dist/cli/people-search.js [query] [limit]
 *
 * Defaults to limit 50 to prevent context overflow in agent sessions.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , query, limitStr] = process.argv;
const limit = limitStr ? parseInt(limitStr, 10) : 50;

runWithHarness("people-search [query] [limit]", async () => {
  return leadsTools.searchPeople.execute({ query: query || undefined, limit });
});
