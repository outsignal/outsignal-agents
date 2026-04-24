import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { serperAdapter } from "@/lib/discovery/adapters/serper";

async function main() {
  const testCompanies = [
    { name: "MONSTER SKIPS LTD", city: "Solihull" },
    { name: "CAPITAL FOODSERVICE LTD", city: "Cheshunt" },
    { name: "GLIDELINE LIMITED", city: "Great Yarmouth" },
    { name: "BLOCKS BUILDERS MERCHANTS LTD", city: "Leicester" },
    { name: "TTL GROUNDWORK LTD", city: "Northampton" },
    { name: "GREEN ENERGY ACCESS SOLUTIONS LIMITED", city: "Doncaster" },
  ];
  const contextKeywords = ["haulage", "logistics", "transport", "freight"] as const;

  for (const { name, city } of testCompanies) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`COMPANY: ${name} (${city})`);
    const { queries, candidates } = await serperAdapter.searchCompanyDomains({
      companyName: name,
      location: city,
      contextKeywords: [...contextKeywords],
      gl: "uk",
      hl: "en-GB",
    });
    console.log("  Query attempts:");
    for (const query of queries) {
      console.log(`    - ${query}`);
    }
    console.log("  Top candidates:");
    for (const candidate of candidates.slice(0, 5)) {
      console.log(
        `    [attempt ${candidate.attempt}] [${candidate.domain}] ` +
        `score=${candidate.score} fuzzy=${candidate.fuzzyScore} title=${candidate.result.title.slice(0, 60)}`,
      );
    }
    if (candidates.length === 0) console.log("    (no candidates)");
  }
}
main().catch(e => { console.error(e); process.exit(1); });
