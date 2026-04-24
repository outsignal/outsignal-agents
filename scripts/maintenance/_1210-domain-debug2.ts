import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { serperAdapter } from "@/lib/discovery/adapters/serper";

async function main() {
  const testCompanies = [
    "SAS INTERNATIONAL LIMITED",
    "JERSEYTEX LTD",
    "MONSTER SKIPS LTD",
    "CAPITAL FOODSERVICE LTD",
    "GLIDELINE LIMITED",
  ];
  const contextKeywords = ["haulage", "logistics", "transport", "freight"] as const;

  for (const name of testCompanies) {
    console.log(`\n=== ${name} ===`);
    const { queries, candidates } = await serperAdapter.searchCompanyDomains({
      companyName: name,
      contextKeywords: [...contextKeywords],
      gl: "uk",
      hl: "en-GB",
    });
    console.log("Queries:");
    for (const query of queries) {
      console.log(`  - ${query}`);
    }
    for (const candidate of candidates.slice(0, 5)) {
      console.log(`  [attempt ${candidate.attempt}] ${candidate.domain} score=${candidate.score}`);
      console.log(`     ${candidate.result.title}`);
    }
    if (candidates.length === 0) console.log("  (no candidates)");
  }
}
main().catch(e => { console.error(e); process.exit(1); });
