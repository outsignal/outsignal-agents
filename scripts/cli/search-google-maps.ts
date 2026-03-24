/**
 * search-google-maps.ts
 *
 * CLI wrapper: search Google Maps for local/SMB businesses.
 * Usage: node dist/cli/search-google-maps.js <jsonFile>
 *
 * JSON file format: { "query": "umbrella companies", "location": "London, UK", "maxResults": 20 }
 * Costs ~$0.005 per search (Apify compute).
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";

const [, , jsonFile] = process.argv;

runWithHarness("search-google-maps <jsonFile>", async () => {
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as Record<string, unknown>;
  if (!params.query) throw new Error("JSON file must contain query field");
  return leadsTools.searchGoogleMaps.execute(params as Parameters<typeof leadsTools.searchGoogleMaps.execute>[0]);
});
