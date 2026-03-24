/**
 * check-google-ads.ts
 *
 * CLI wrapper: check which domains are actively running Google Ads.
 * Usage: node dist/cli/check-google-ads.js <jsonFile>
 *
 * JSON file format: { "domains": ["acme.com", "example.co.uk"], "region": "GB" }
 * Costs ~$0.005 per domain checked.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , jsonFile] = process.argv;

runWithHarness("check-google-ads <jsonFile>", async () => {
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as { domains: string[]; region?: string };
  if (!params.domains || !Array.isArray(params.domains)) throw new Error("JSON file must contain domains array");
  return leadsTools.checkGoogleAds.execute({ domains: params.domains, region: params.region });
});
