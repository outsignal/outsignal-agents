/**
 * One-off script: Check BlankTag Shopify stores for Google Ads via Apify.
 *
 * Usage:
 *   cd /Users/jjay/programs/outsignal-agents
 *   npx tsx scripts/blanktag-google-ads-check.ts
 */

import fs from "fs";
import path from "path";
import { checkDomainsForGoogleAds } from "../src/lib/discovery/adapters/google-ads";

const CSV_PATH = path.resolve(__dirname, "../data/blanktag-clay-stores.csv");
const OUTPUT_PATH = path.resolve(
  __dirname,
  "../data/blanktag-google-ads-results.json"
);

/** Minimal CSV line parser that handles quoted fields. */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

async function main() {
  // Step 1: Parse CSV and extract domains
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const headers = parseCSVLine(lines[0]);
  const nameIdx = headers.findIndex((h) => h.trim().replace(/"/g, "") === "Name");
  if (nameIdx === -1) throw new Error("Could not find 'Name' column in CSV");

  const domains = [
    ...new Set(
      lines
        .slice(1)
        .map((line) => {
          const fields = parseCSVLine(line);
          return (fields[nameIdx] ?? "").trim().replace(/^"|"$/g, "");
        })
        .filter((d) => d.length > 0 && d.includes("."))
        .map((d) => d.replace(/^www\./i, ""))
    ),
  ];

  console.log(`Extracted ${domains.length} unique domains from CSV`);
  console.log("First 5:", domains.slice(0, 5));
  console.log("Last 5:", domains.slice(-5));

  // Step 2: Run Google Ads check (all at once — 99 domains, actor handles batching)
  console.log(`\nSending ${domains.length} domains to Google Ads Transparency checker (region: GB)...`);
  console.log("This may take several minutes...\n");

  const results = await checkDomainsForGoogleAds(domains, { region: "GB" });

  // Step 3: Report results
  const withAds = results.filter((r) => r.hasAds);
  const withoutAds = results.filter((r) => !r.hasAds);

  console.log("=".repeat(70));
  console.log(`RESULTS`);
  console.log("=".repeat(70));
  console.log(`Total domains checked: ${results.length}`);
  console.log(`With active Google Ads: ${withAds.length}`);
  console.log(`Without Google Ads: ${withoutAds.length}`);
  console.log();

  if (withAds.length > 0) {
    console.log("--- STORES WITH GOOGLE ADS ---");
    for (const r of withAds.sort((a, b) => b.adCount - a.adCount)) {
      console.log(
        `  ${r.domain} — ${r.adCount} ads | formats: ${r.formats.join(", ") || "N/A"} | advertiser: ${r.advertiserName ?? "N/A"} | latest: ${r.latestAdDate?.split("T")[0] ?? "N/A"}`
      );
    }
    console.log();
  }

  if (withoutAds.length > 0) {
    console.log("--- STORES WITHOUT GOOGLE ADS ---");
    console.log(
      withoutAds
        .map((r) => r.domain)
        .sort()
        .join(", ")
    );
    console.log();
  }

  // Save full results
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`Full results saved to: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
