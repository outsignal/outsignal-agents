/**
 * search-ecommerce.ts
 *
 * CLI wrapper: search a 14M+ ecommerce store database.
 * Usage: node dist/cli/search-ecommerce.js <jsonFile>
 *
 * JSON file format: { "platform": "shopify", "category": "Apparel", "country": "GB", "maxResults": 50 }
 * Costs ~$0.004 per lead (pay-per-result).
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { leadsTools } from "@/lib/agents/leads";
import { validateDiscoveryFilters } from "@/lib/discovery/validation";

const [, , jsonFile] = process.argv;

runWithHarness("search-ecommerce <jsonFile>", async () => {
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as Record<string, unknown>;

  const validation = validateDiscoveryFilters("ecommerce-stores", params);
  if (!validation.valid) {
    const blocks = validation.issues.filter(i => i.type === "hard-block");
    console.error(`\nBLOCKED (${blocks.length} issue${blocks.length > 1 ? "s" : ""}):`);
    for (const issue of blocks) {
      console.error(`  [${issue.check}] ${issue.message}`);
      console.error(`  Suggestion: ${issue.suggestion}`);
    }
    process.exit(1);
  }
  const warnings = validation.issues.filter(i => i.type === "warning");
  if (warnings.length) {
    console.warn(`\nWARNINGS (${warnings.length}):`);
    for (const w of warnings) {
      console.warn(`  [${w.check}] ${w.message}`);
    }
  }

  return leadsTools.searchEcommerceStores.execute(params as Parameters<typeof leadsTools.searchEcommerceStores.execute>[0]);
});
