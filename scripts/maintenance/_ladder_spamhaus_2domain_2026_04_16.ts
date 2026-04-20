import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { emailguard } from "@/lib/emailguard/client";

const TARGETS = [
  { domain: "laddergroup.co", egDomainUuid: "a1729da6-e6eb-45c1-89b0-30f6600fa1f6" },
  { domain: "theladder.group", egDomainUuid: "a1729d9d-af9c-491f-a761-4a9df169b816" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollRep(uuid: string): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await emailguard.getDomainReputation(uuid);
      const s = (r as any).status;
      if (!s || (s !== "pending" && s !== "processing" && s !== "queued")) {
        return r;
      }
    } catch (e) {
      // 404 while job queues up is fine — retry
    }
    await sleep(5000);
  }
  return null;
}

function matchesDomain(record: Record<string, unknown>, target: string): boolean {
  const candidates = [
    (record as any).domain,
    (record as any).domain_or_ip,
    (record as any).name,
    (record as any).subject,
    (record as any).host,
  ]
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.toLowerCase());
  return candidates.some((c) => c === target.toLowerCase() || c.endsWith(`.${target.toLowerCase()}`));
}

async function main() {
  // Step 1: verify the UUIDs are EG domain records
  console.log(`=== Verifying EG domain records ===`);
  for (const t of TARGETS) {
    try {
      const d = await emailguard.getDomain(t.egDomainUuid);
      console.log(`  ${t.egDomainUuid} -> name=${(d as any).name}  ip=${(d as any).ip}`);
    } catch (e) {
      console.log(`  ${t.egDomainUuid} -> NOT FOUND as EG Domain: ${(e as Error).message.slice(0, 150)}`);
    }
  }

  // Step 2: Fire Domain Reputation (POST) per domain
  console.log(`\n=== Firing Domain Reputation checks ===`);
  const repJobs: Record<string, string | null> = {};
  for (const t of TARGETS) {
    try {
      const r = await emailguard.checkDomainReputation(t.domain);
      const uuid = (r as any).uuid ?? (r as any).id;
      console.log(`  ${t.domain}: job uuid=${uuid}  initial=${JSON.stringify(r).slice(0, 200)}`);
      repJobs[t.domain] = uuid ? String(uuid) : null;
    } catch (e) {
      console.log(`  ${t.domain}: FIRE FAILED ${(e as Error).message.slice(0, 200)}`);
      repJobs[t.domain] = null;
    }
  }

  // Step 3: Pull list snapshots for the other Spamhaus checks (GET-only)
  console.log(`\n=== Pulling list endpoints (may be background-populated) ===`);
  const lists: Record<string, Record<string, unknown>[]> = {};
  const listCalls: [string, () => Promise<Record<string, unknown>[]>][] = [
    ["A-Record Reputation", async () => (await emailguard.listARecordReputation()) as Record<string, unknown>[]],
    ["Domain Context", async () => (await emailguard.listDomainContexts()) as Record<string, unknown>[]],
    ["Domain Senders", async () => (await emailguard.listDomainSenders()) as Record<string, unknown>[]],
    ["Nameserver Reputation", async () => (await emailguard.listNameserverReputation()) as Record<string, unknown>[]],
    ["Domain Reputation (list)", async () => (await emailguard.listDomainReputation()) as Record<string, unknown>[]],
  ];
  for (const [name, fn] of listCalls) {
    try {
      const data = await fn();
      lists[name] = data;
      console.log(`  ${name}: ${data.length} total records`);
    } catch (e) {
      console.log(`  ${name}: FAILED ${(e as Error).message.slice(0, 200)}`);
      lists[name] = [];
    }
  }

  // Step 4: Poll the fresh Domain Reputation jobs
  console.log(`\n=== Polling Domain Reputation results ===`);
  const repResults: Record<string, Record<string, unknown> | null> = {};
  for (const t of TARGETS) {
    const u = repJobs[t.domain];
    if (!u) {
      repResults[t.domain] = null;
      continue;
    }
    const r = await pollRep(u);
    repResults[t.domain] = r;
  }

  // Step 5: Render full output per domain
  for (const t of TARGETS) {
    console.log(`\n\n================================================================`);
    console.log(`DOMAIN: ${t.domain}`);
    console.log(`================================================================`);

    console.log(`\n--- Domain Reputation (fresh fire, uuid=${repJobs[t.domain]}) ---`);
    console.log(JSON.stringify(repResults[t.domain], null, 2));

    for (const [name, records] of Object.entries(lists)) {
      if (name === "Domain Reputation (list)") continue;
      const matches = records.filter((r) => matchesDomain(r, t.domain));
      console.log(`\n--- ${name} — ${matches.length} match(es) ---`);
      if (matches.length === 0) {
        console.log(`  (no records for ${t.domain} in EG workspace)`);
        continue;
      }
      for (const m of matches) {
        console.log(JSON.stringify(m, null, 2));
      }
    }

    // Also show whether the fresh rep job result appears in the list
    const listMatches = (lists["Domain Reputation (list)"] || []).filter((r) => matchesDomain(r, t.domain));
    console.log(`\n--- Domain Reputation (list history, ${listMatches.length} match) ---`);
    for (const m of listMatches) {
      console.log(JSON.stringify(m, null, 2));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
