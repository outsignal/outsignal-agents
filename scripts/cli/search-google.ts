/**
 * search-google.ts
 *
 * CLI wrapper: search Google via Serper.dev (web or maps mode).
 * Usage: node dist/cli/search-google.js <workspaceSlug> <query> [mode]
 *
 * mode: "web" (default) or "maps"
 * COSTS 1 CREDIT PER SEARCH.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , workspaceSlug, query, mode] = process.argv;

runWithHarness("search-google <workspaceSlug> <query> [mode]", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!query) throw new Error("Missing required argument: query");
  const searchMode = (mode === "maps" ? "maps" : "web") as "web" | "maps";
  return leadsTools.searchGoogle.execute({ workspaceSlug, query, mode: searchMode });
});
