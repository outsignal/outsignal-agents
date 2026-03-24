/**
 * list-get.ts
 *
 * CLI wrapper: get details of a target list including all people.
 * Usage: node dist/cli/list-get.js <listId>
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , listId] = process.argv;

runWithHarness("list-get <listId>", async () => {
  if (!listId) throw new Error("Missing required argument: listId");
  return leadsTools.getList.execute({ listId });
});
