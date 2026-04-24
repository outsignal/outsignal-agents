/**
 * Debug: check what Serper returns for a few failed companies.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { serperAdapter } from "@/lib/discovery/adapters/serper";

const testCompanies = [
  "SAS INTERNATIONAL LIMITED",
  "MONSTER SKIPS LTD",
  "JERSEYTEX LTD",
  "WOOD WASTE RECYCLING LTD",
  "I & M SHAW LIMITED",
];
const DOMAIN_CONTEXT_KEYWORDS = ["haulage", "logistics", "transport", "freight"] as const;

async function main() {
  for (const company of testCompanies) {
    console.log(`\n=== ${company} ===`);
    const { queries, candidates, costUsd } = await serperAdapter.searchCompanyDomains({
      companyName: company,
      contextKeywords: [...DOMAIN_CONTEXT_KEYWORDS],
      gl: "uk",
      hl: "en-GB",
    });

    console.log(`Queries (${queries.length}) | Cost: $${costUsd.toFixed(3)}`);
    for (const query of queries) {
      console.log(`  - ${query}`);
    }

    console.log(`Candidates: ${candidates.length}`);
    for (const candidate of candidates.slice(0, 5)) {
      console.log(
        `  [attempt ${candidate.attempt}] score=${candidate.score} fuzzy=${candidate.fuzzyScore} ` +
        `domain=${candidate.domain} keywords=${candidate.keywordHits.join(",") || "-"}`,
      );
      console.log(`     ${candidate.result.title}`);
    }
    if (candidates.length === 0) console.log("  (no candidates)");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
