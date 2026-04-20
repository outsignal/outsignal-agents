import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { emailguard } from "@/lib/emailguard/client";

const DOMAINS = [
  "laddergroup.io",
  "theladder.group",
  "theladdergroup.co",
  "laddergroup.co",
  "laddergroup.co.uk",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (const d of DOMAINS) {
    console.log(`\n=== ${d} ===`);
    try {
      const initial = await emailguard.runAdHocBlacklist(d);
      console.log(`  created check id=${initial.id} lists=${initial.blacklists?.length ?? 0}`);
      // Poll up to 6 times, 5s apart
      let last = initial;
      for (let i = 0; i < 6; i++) {
        await sleep(5000);
        last = await emailguard.getBlacklistCheck(initial.id);
        const total = last.blacklists?.length ?? 0;
        const listed = Array.isArray(last.blacklists)
          ? last.blacklists.filter((b) => b.listed === true)
          : [];
        console.log(`  poll ${i + 1}: lists=${total} listed=${listed.length}`);
        if (total > 0) break;
      }
      const listedFinal = Array.isArray(last.blacklists)
        ? last.blacklists.filter((b) => b.listed === true)
        : [];
      if (listedFinal.length > 0) {
        console.log(`  FINAL: LISTED on: ${listedFinal.map((l) => l.name).join(", ")}`);
      } else {
        const total = last.blacklists?.length ?? 0;
        console.log(`  FINAL: ${total} lists queried, 0 listings — CLEAN`);
        if (total > 0) {
          console.log(`  (queried: ${last.blacklists?.slice(0, 10).map((b) => b.name).join(", ")}${total > 10 ? "..." : ""})`);
        }
      }
    } catch (err) {
      console.log(`  FAILED: ${(err as Error).message}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
