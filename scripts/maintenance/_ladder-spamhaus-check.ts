import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { emailguard } from "@/lib/emailguard/client";

const TARGET_DOMAINS = new Set(["laddergroup.co", "theladder.group"]);
const TARGET_UUIDS = new Set([
  "a1729da6-e6eb-45c1-89b0-30f6600fa1f6",
  "a1729d9d-af9c-491f-a761-4a9df169b816",
]);

function filterByDomainUuid(list: any[]): any[] {
  return list.filter((item: any) => {
    const stringFields = [
      item?.domain,
      item?.domain?.name,
      item?.name,
      item?.subject,
      item?.host,
      item?.domain_or_ip,
    ].filter((x): x is string => typeof x === "string");
    if (stringFields.some((s) => TARGET_DOMAINS.has(s.toLowerCase()))) return true;

    const uuidFields = [
      item?.domain?.uuid,
      item?.email_guard_domain?.uuid,
      item?.domain_uuid,
      item?.domain_id,
    ];
    return uuidFields.some((c) => c && TARGET_UUIDS.has(String(c)));
  });
}

async function main() {
  const endpoints = [
    { name: "domain-reputation", fn: () => emailguard.listDomainReputation() },
    { name: "domain-contexts", fn: () => emailguard.listDomainContexts() },
    { name: "domain-senders", fn: () => emailguard.listDomainSenders() },
    { name: "nameserver-reputation", fn: () => emailguard.listNameserverReputation() },
    { name: "a-record-reputation", fn: () => emailguard.listARecordReputation() },
  ];

  const out: Record<string, any> = {};
  for (const ep of endpoints) {
    try {
      const all = await ep.fn();
      const filtered = filterByDomainUuid(all as any[]);
      out[ep.name] = {
        totalInResponse: (all as any[]).length,
        matchedLadder: filtered.length,
        firstItemShape: (all as any[])[0] ? Object.keys((all as any[])[0]) : [],
        firstItemDomainField: (all as any[])[0]?.domain ?? null,
        items: filtered,
      };
    } catch (err: any) {
      out[ep.name] = { error: err.message };
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
