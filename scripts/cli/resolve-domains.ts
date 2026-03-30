/**
 * resolve-domains.ts
 *
 * CLI wrapper: resolve company names to domains.
 * Usage: node dist/cli/resolve-domains.js --file /tmp/{uuid}.json
 *
 * JSON file format:
 * {
 *   "companies": ["Acme Corp", "Widget Ltd"],
 *   "icpContext": { "location": "UK", "industry": "recruitment" }
 * }
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { resolveCompanyDomains } from "@/lib/discovery/domain-resolver";

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const filePath = fileIdx !== -1 ? args[fileIdx + 1] : args[0];

runWithHarness("resolve-domains --file <path>", async () => {
  if (!filePath) throw new Error("Missing required argument: --file <path>");

  const input = JSON.parse(readFileSync(filePath, "utf8")) as {
    companies: string[];
    icpContext?: { location?: string; industry?: string };
  };

  if (!input.companies || !Array.isArray(input.companies)) {
    throw new Error("JSON file must contain a 'companies' array");
  }

  return resolveCompanyDomains(input.companies, input.icpContext ?? {});
});
