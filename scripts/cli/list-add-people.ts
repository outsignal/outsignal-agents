/**
 * list-add-people.ts
 *
 * CLI wrapper: add people to a target list by their IDs.
 * Usage: node dist/cli/list-add-people.js <listId> <jsonFile>
 *
 * JSON file format: { "personIds": ["id1", "id2", ...] }
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , listId, jsonFile] = process.argv;

runWithHarness("list-add-people <listId> <jsonFile>", async () => {
  if (!listId) throw new Error("Missing required argument: listId");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as { personIds: string[] };
  if (!params.personIds) throw new Error("JSON file must contain personIds array");
  return leadsTools.addPeopleToList.execute({ listId, personIds: params.personIds });
});
