// Ladder Group DNS Step 3: register new domains in EG, declare DKIM, pull verdict.
// Run: npx tsx scripts/maintenance/_laddergroup_eg_step3_2026_04_16.ts
import "dotenv/config";
import { emailguard } from "../../src/lib/emailguard/client";

const EXISTING: Record<string, string> = {
  "theladder.group": "a1729d9d-af9c-491f-a761-4a9df169b816",
  "laddergroup.co": "a1729da6-e6eb-45c1-89b0-30f6600fa1f6",
  "laddergroup.co.uk": "a1729dae-7ee5-4bb8-8c46-69feb507d5f5",
};
const NEW_DOMAINS = ["laddergroup.io", "theladdergroup.co"];

async function main() {
  const uuids: Record<string, string> = { ...EXISTING };
  const regResults: Record<string, string> = {};
  for (const d of Object.keys(EXISTING)) regResults[d] = "EXISTING";

  // 1) Register new domains
  for (const d of NEW_DOMAINS) {
    try {
      const created = await emailguard.createDomain(d);
      uuids[d] = created.uuid;
      regResults[d] = `CREATED uuid=${created.uuid}`;
    } catch (err: unknown) {
      const e = err as Error & { status?: number; body?: string };
      if (e.body && /already|exists|duplicate|taken/i.test(e.body)) {
        const all = await emailguard.listDomains();
        const found = all.find((x) => x.name === d);
        if (found) {
          uuids[d] = found.uuid;
          regResults[d] = `ALREADY_EXISTS uuid=${found.uuid}`;
        } else {
          regResults[d] = `CREATE_CONFLICT_NOT_FOUND status=${e.status} body=${e.body?.slice(0, 200)}`;
        }
      } else {
        regResults[d] = `ERROR status=${e.status} body=${e.body?.slice(0, 200)}`;
      }
    }
  }

  console.log("=== REGISTRATION ===");
  for (const [d, r] of Object.entries(regResults)) console.log(`${d}: ${r}`);

  // 2) Declare 'google' DKIM selector on all 5
  console.log("\n=== DKIM SELECTOR DECLARATION (google) ===");
  const allDomains = [...Object.keys(EXISTING), ...NEW_DOMAINS];
  for (const d of allDomains) {
    const uuid = uuids[d];
    if (!uuid) {
      console.log(`${d}: SKIP (no uuid)`);
      continue;
    }
    try {
      await emailguard.checkDkim(uuid, ["google"]);
      console.log(`${d}: OK`);
    } catch (err: unknown) {
      const e = err as Error & { status?: number; body?: string };
      console.log(`${d}: FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
    }
  }

  // SPF + DMARC check triggers on new domains (existing ones already triggered in audit)
  console.log("\n=== SPF/DMARC RECHECK (new domains) ===");
  for (const d of NEW_DOMAINS) {
    const uuid = uuids[d];
    if (!uuid) continue;
    try {
      await emailguard.checkSpf(uuid);
      console.log(`${d}: SPF check triggered`);
    } catch (err: unknown) {
      const e = err as Error & { status?: number; body?: string };
      console.log(`${d}: SPF_FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
    }
    try {
      await emailguard.checkDmarc(uuid);
      console.log(`${d}: DMARC check triggered`);
    } catch (err: unknown) {
      const e = err as Error & { status?: number; body?: string };
      console.log(`${d}: DMARC_FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
    }
  }

  // Let EG settle after triggers
  await new Promise((r) => setTimeout(r, 4000));

  // 3) Pull verdict per domain
  console.log("\n=== FULL VERDICT ===");
  const dmarcDomains = await emailguard.listDmarcDomains().catch(() => []);
  const blacklists = await emailguard.listDomainBlacklists().catch(() => []);

  for (const d of allDomains) {
    const uuid = uuids[d];
    if (!uuid) {
      console.log(`\nDOMAIN: ${d}\n  (no uuid — skipped)`);
      continue;
    }
    let info: Awaited<ReturnType<typeof emailguard.getDomain>> | null = null;
    try {
      info = await emailguard.getDomain(uuid);
    } catch (err: unknown) {
      const e = err as Error & { status?: number; body?: string };
      console.log(`\nDOMAIN: ${d}\n  getDomain FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
      continue;
    }
    const dmarcEntry = (dmarcDomains as Array<Record<string, unknown>>).find(
      (x) => (x.name ?? x.domain) === d,
    );
    const blEntries = (blacklists as Array<Record<string, unknown>>).filter(
      (x) => (x.domain ?? x.name) === d,
    );
    const blHits = blEntries.reduce((acc, e) => {
      const listed =
        (e as { blacklisted?: boolean }).blacklisted === true ||
        ((e as { hits?: number }).hits ?? 0) > 0 ||
        ((e as { listed?: number }).listed ?? 0) > 0;
      return acc + (listed ? 1 : 0);
    }, 0);

    console.log(`\nDOMAIN: ${d}`);
    console.log(`  Registration: ${regResults[d]} (uuid=${uuid})`);
    console.log(`  SPF valid: ${info.spf_valid === true ? "y" : info.spf_valid === false ? "n" : "?"}`);
    console.log(`  DKIM valid: ${info.dkim_valid === true ? "y" : info.dkim_valid === false ? "n" : "?"}`);
    console.log(`  DMARC valid: ${info.dmarc_valid === true ? "y" : info.dmarc_valid === false ? "n" : "?"}`);
    console.log(`  DMARC monitored: ${dmarcEntry ? "y" : "n"}`);
    console.log(`  Blacklist hits: ${blHits} (entries: ${blEntries.length})`);
    console.log(`  SPF record: ${info.spf_record ?? "(none)"}`);
    console.log(`  DMARC record: ${info.dmarc_record ?? "(none)"}`);
    console.log(`  DKIM records: ${JSON.stringify(info.dkim_records ?? [])}`);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
