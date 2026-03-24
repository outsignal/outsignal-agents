/**
 * proposal-create.ts
 *
 * CLI wrapper: create a new proposal for a client.
 * Usage: node dist/cli/proposal-create.js <jsonFile>
 *
 * JSON file format: {
 *   "clientName": "Acme Corp",
 *   "companyOverview": "...",
 *   "packageType": "email",
 *   "clientEmail": "client@example.com",
 *   "setupFee": 50000,
 *   "platformCost": 100000,
 *   "retainerCost": 150000
 * }
 * Prices are in pence.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { orchestratorTools } from "@/lib/agents/orchestrator";

const [, , jsonFile] = process.argv;

runWithHarness("proposal-create <jsonFile>", async () => {
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as Parameters<typeof orchestratorTools.createProposal.execute>[0];
  if (!params.clientName) throw new Error("JSON file must contain clientName");
  if (!params.packageType) throw new Error("JSON file must contain packageType");
  if (!params.companyOverview) throw new Error("JSON file must contain companyOverview");
  return orchestratorTools.createProposal.execute(params);
});
