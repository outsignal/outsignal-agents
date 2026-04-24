import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { serperAdapter } from "@/lib/discovery/adapters/serper";

async function main() {
  const cases = [
    { companyName: "Monster Skips Ltd" },
    { companyName: "SAS International Limited" },
    { companyName: "I & M Shaw Limited" },
  ];

  for (const [index, testCase] of cases.entries()) {
    console.log(`Test ${index + 1}: ${testCase.companyName}`);
    try {
      const { queries, candidates, costUsd } = await serperAdapter.searchCompanyDomains({
        companyName: testCase.companyName,
        contextKeywords: ["haulage", "logistics", "transport", "freight"],
        gl: "uk",
        hl: "en-GB",
      });
      console.log(`  Queries (${queries.length}), Cost: $${costUsd.toFixed(3)}`);
      for (const query of queries) {
        console.log(`  - ${query}`);
      }
      for (const candidate of candidates.slice(0, 3)) {
        console.log(`  [attempt ${candidate.attempt}] ${candidate.domain} — score ${candidate.score}`);
      }
      if (candidates.length === 0) console.log("  (no candidates)");
    } catch (e) {
      console.log("  ERROR:", e);
    }
    console.log();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
