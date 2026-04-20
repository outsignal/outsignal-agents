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

async function tryCheck(name: string, fn: (d: string) => Promise<Record<string, unknown>>, getFn: ((uuid: string) => Promise<Record<string, unknown>>) | null) {
  console.log(`\n========== ${name} ==========`);
  for (const d of DOMAINS) {
    try {
      const r = await fn(d);
      const uuid = (r as any).uuid ?? (r as any).id;
      let final = r;
      if (getFn && uuid) {
        for (let i = 0; i < 6; i++) {
          await sleep(4000);
          try {
            final = await getFn(String(uuid));
            // Stop polling when status looks complete
            const s = (final as any).status;
            if (s && s !== "pending" && s !== "processing") break;
          } catch {}
        }
      }
      // Trim for readability
      const status = (final as any).status;
      const listed = (final as any).is_listed ?? (final as any).listed;
      const reputation = (final as any).reputation ?? (final as any).score ?? (final as any).result;
      const context = (final as any).context;
      console.log(`  ${d}: status=${status ?? "-"} listed=${listed ?? "-"} reputation=${JSON.stringify(reputation) ?? "-"} context=${JSON.stringify(context)?.slice(0, 150) ?? "-"}`);
      // Dump raw trimmed keys
      const keys = Object.keys(final as object);
      console.log(`    keys: ${keys.join(", ")}`);
    } catch (err) {
      console.log(`  ${d}: FAILED ${(err as Error).message.slice(0, 200)}`);
    }
  }
}

async function main() {
  await tryCheck("SURBL", (d) => emailguard.runSurblCheck(d) as any, (u) => emailguard.getSurblCheck(u) as any);
  await tryCheck("Spamhaus Domain Context", (d) => emailguard.checkDomainContext(d) as any, (u) => emailguard.getDomainContext(u) as any);
  await tryCheck("Spamhaus A-Record Reputation", (d) => emailguard.checkARecordReputation(d) as any, (u) => emailguard.getARecordReputation(u) as any);
  await tryCheck("Spamhaus Domain Senders", (d) => emailguard.checkDomainSenders(d) as any, (u) => emailguard.getDomainSenders(u) as any);
}
main().catch((e) => { console.error(e); process.exit(1); });
