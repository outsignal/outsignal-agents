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

function matchDomain(record: Record<string, unknown>, target: string): boolean {
  const candidates = [
    (record as any).domain,
    (record as any).domain_or_ip,
    (record as any).name,
  ]
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.toLowerCase());
  return candidates.includes(target.toLowerCase());
}

async function main() {
  const lists = {
    "SURBL": await emailguard.listSurblChecks().catch(() => []),
    "Domain Blacklist": await emailguard.listDomainBlacklists().catch(() => []),
    "Spamhaus A-Record Reputation": await emailguard.listARecordReputation().catch((e) => { console.error("aRec:", e.message); return []; }),
    "Spamhaus Domain Context": await emailguard.listDomainContexts().catch((e) => { console.error("ctx:", e.message); return []; }),
    "Spamhaus Domain Reputation": await emailguard.listDomainReputation().catch((e) => { console.error("rep:", e.message); return []; }),
    "Spamhaus Domain Senders": await emailguard.listDomainSenders().catch((e) => { console.error("sen:", e.message); return []; }),
    "Spamhaus Nameserver Reputation": await emailguard.listNameserverReputation().catch((e) => { console.error("ns:", e.message); return []; }),
  };

  for (const [name, records] of Object.entries(lists)) {
    console.log(`\n========== ${name} (total records: ${records.length}) ==========`);
    for (const d of DOMAINS) {
      const related = records.filter((r) => matchDomain(r as Record<string, unknown>, d));
      if (related.length === 0) {
        console.log(`  ${d}: no records`);
        continue;
      }
      for (const r of related) {
        const rec = r as Record<string, unknown>;
        // Extract relevant fields
        const brief: Record<string, unknown> = {};
        for (const key of ["uuid", "id", "status", "listed", "is_listed", "reputation", "score", "context", "result", "created_at", "blacklists"]) {
          if (key in rec) brief[key] = rec[key];
        }
        if (brief.blacklists && Array.isArray(brief.blacklists)) {
          const listed = (brief.blacklists as Array<{ name: string; listed: boolean }>).filter((b) => b.listed === true);
          brief.blacklists = `${listed.length}/${(brief.blacklists as Array<unknown>).length} listed${listed.length ? `: ${listed.map((l) => l.name).join(", ")}` : ""}`;
        }
        console.log(`  ${d}: ${JSON.stringify(brief).slice(0, 400)}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
