/**
 * _ladder_audit_2026_04_16.ts
 *
 * Throwaway damage-assessment script for 5 Ladder Group sending domains.
 * Reuses the EmailGuardClient (no raw fetch). Prints blacklist hits per domain.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_ladder_audit_2026_04_16.ts
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { emailguard } from "@/lib/emailguard/client";

const DOMAINS: Array<{ domain: string; uuid: string }> = [
  { domain: "laddergroup.io", uuid: "a18e7a73-c88a-45cc-95e9-dea0fcab1faf" },
  { domain: "theladder.group", uuid: "a1729d9d-af9c-491f-a761-4a9df169b816" },
  { domain: "theladdergroup.co", uuid: "a18e7a74-35fb-4554-9375-aab43478cb5a" },
  { domain: "laddergroup.co", uuid: "a1729da6-e6eb-45c1-89b0-30f6600fa1f6" },
  { domain: "laddergroup.co.uk", uuid: "a1729dae-7ee5-4bb8-8c46-69feb507d5f5" },
];

async function main() {
  console.log("=".repeat(80));
  console.log("Ladder Group EmailGuard audit — 2026-04-16");
  console.log("=".repeat(80));

  // ---------------------------------------------------------------------------
  // 1. Fetch all domain blacklist checks from EmailGuard (listed history)
  // ---------------------------------------------------------------------------
  console.log("\n[1/3] Fetching listDomainBlacklists() …");
  let allDomainChecks: Awaited<ReturnType<typeof emailguard.listDomainBlacklists>> = [];
  try {
    allDomainChecks = await emailguard.listDomainBlacklists();
    console.log(`  total domain blacklist checks in account: ${allDomainChecks.length}`);
  } catch (err) {
    console.error(`  FAILED: ${(err as Error).message}`);
  }

  // ---------------------------------------------------------------------------
  // 2. Fetch SURBL checks
  // ---------------------------------------------------------------------------
  console.log("\n[2/3] Fetching listSurblChecks() …");
  let allSurblChecks: Awaited<ReturnType<typeof emailguard.listSurblChecks>> = [];
  try {
    allSurblChecks = await emailguard.listSurblChecks();
    console.log(`  total SURBL checks in account: ${allSurblChecks.length}`);
  } catch (err) {
    console.error(`  FAILED: ${(err as Error).message}`);
  }

  // ---------------------------------------------------------------------------
  // 3. Per-domain rollup: getDomain() for SPF/DKIM/DMARC/IP, filter checks
  // ---------------------------------------------------------------------------
  console.log("\n[3/3] Per-domain rollup (getDomain + ad-hoc blacklist) …\n");

  for (const { domain, uuid } of DOMAINS) {
    console.log("-".repeat(80));
    console.log(`DOMAIN: ${domain}   (uuid=${uuid})`);
    console.log("-".repeat(80));

    // (a) core domain record
    try {
      const d = await emailguard.getDomain(uuid);
      console.log(`  ip: ${d.ip ?? "null"}`);
      console.log(`  spf_valid: ${d.spf_valid ?? "unknown"}`);
      console.log(`  dkim_valid: ${d.dkim_valid ?? "unknown"}`);
      console.log(`  dmarc_valid: ${d.dmarc_valid ?? "unknown"}`);
    } catch (err) {
      console.log(`  getDomain FAILED: ${(err as Error).message}`);
    }

    // (b) Filter stored blacklist checks for this domain-or-ip
    const related = allDomainChecks.filter((c) => {
      const target = String(c.domain_or_ip ?? "").toLowerCase();
      return target === domain.toLowerCase();
    });
    console.log(`  stored domain blacklist checks for ${domain}: ${related.length}`);
    for (const c of related) {
      const listed = Array.isArray(c.blacklists)
        ? c.blacklists.filter((b) => b.listed === true)
        : [];
      console.log(
        `    - check id=${c.id} listed=${listed.length}/${c.blacklists?.length ?? 0}${
          listed.length
            ? ` (${listed.map((l) => l.name).join(", ")})`
            : ""
        }`,
      );
    }

    // (c) Filter SURBL checks
    const surbl = allSurblChecks.filter(
      (c) => String(c.domain ?? "").toLowerCase() === domain.toLowerCase(),
    );
    console.log(`  stored SURBL checks for ${domain}: ${surbl.length}`);
    for (const c of surbl) {
      console.log(`    - surbl uuid=${c.uuid} raw=${JSON.stringify(c).slice(0, 200)}`);
    }

    // (d) Run a fresh ad-hoc blacklist check to get current state
    try {
      const fresh = await emailguard.runAdHocBlacklist(domain);
      const listed = Array.isArray(fresh.blacklists)
        ? fresh.blacklists.filter((b) => b.listed === true)
        : [];
      console.log(
        `  LIVE ad-hoc check: ${listed.length} hits / ${
          fresh.blacklists?.length ?? 0
        } lists${listed.length ? ` (${listed.map((l) => l.name).join(", ")})` : " — CLEAN"}`,
      );
    } catch (err) {
      console.log(`  ad-hoc blacklist FAILED: ${(err as Error).message}`);
    }

    console.log();
  }

  console.log("=".repeat(80));
  console.log("Done.");
  console.log("=".repeat(80));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
