/**
 * check-tech-stack.ts
 *
 * CLI wrapper: check what technologies domains use via BuiltWith.
 * Usage: node dist/cli/check-tech-stack.js <jsonFile>
 *
 * JSON file format: { "domains": ["acme.com"], "filterTechnologies": ["Shopify"] }
 * Costs ~$0.005 per domain checked.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , jsonFile] = process.argv;

runWithHarness("check-tech-stack <jsonFile>", async () => {
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as { domains: string[]; filterTechnologies?: string[] };
  if (!params.domains || !Array.isArray(params.domains)) throw new Error("JSON file must contain domains array");
  return leadsTools.checkTechStack.execute({ domains: params.domains, filterTechnologies: params.filterTechnologies });
});
