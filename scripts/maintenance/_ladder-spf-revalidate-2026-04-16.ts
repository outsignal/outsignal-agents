// Ladder Group SPF re-validation after GoDaddy fix on laddergroup.io.
// Run: npx tsx scripts/maintenance/_ladder-spf-revalidate-2026-04-16.ts
import "dotenv/config";
import { emailguard } from "../../src/lib/emailguard/client";

const LADDER_IO_UUID = "a18e7a73-c88a-45cc-95e9-dea0fcab1faf";

const OTHERS: Record<string, string> = {
  "theladder.group": "a1729d9d-af9c-491f-a761-4a9df169b816",
  "laddergroup.co": "a1729da6-e6eb-45c1-89b0-30f6600fa1f6",
  "laddergroup.co.uk": "a1729dae-7ee5-4bb8-8c46-69feb507d5f5",
  // theladdergroup.co uuid resolved at runtime via listDomains
};

function summarize(d: string, info: Record<string, unknown>): void {
  console.log(`\nDOMAIN: ${d}`);
  console.log(`  SPF valid:   ${info.spf_valid === true ? "y" : info.spf_valid === false ? "n" : "?"}`);
  console.log(`  DKIM valid:  ${info.dkim_valid === true ? "y" : info.dkim_valid === false ? "n" : "?"}`);
  console.log(`  DMARC valid: ${info.dmarc_valid === true ? "y" : info.dmarc_valid === false ? "n" : "?"}`);
  console.log(`  SPF record:   ${info.spf_record ?? "(none)"}`);
  console.log(`  DMARC record: ${info.dmarc_record ?? "(none)"}`);
  console.log(`  DKIM records: ${JSON.stringify(info.dkim_records ?? [])}`);
  for (const k of ["spf_issues", "dkim_issues", "dmarc_issues", "issues"]) {
    if (info[k]) console.log(`  ${k}: ${JSON.stringify(info[k])}`);
  }
}

async function main() {
  // Resolve theladdergroup.co uuid
  try {
    const all = await emailguard.listDomains();
    const tlg = all.find((x) => x.name === "theladdergroup.co");
    if (tlg) OTHERS["theladdergroup.co"] = tlg.uuid;
  } catch (err) {
    console.log("listDomains failed:", (err as Error).message);
  }

  // ================================================
  // STEP 1: laddergroup.io — PATCH SPF then GET
  // ================================================
  console.log("=== laddergroup.io SPF RE-VALIDATION ===");
  try {
    await emailguard.checkSpf(LADDER_IO_UUID);
    console.log("PATCH spf-record: OK");
  } catch (err) {
    const e = err as Error & { status?: number; body?: string };
    console.log(`PATCH spf-record FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
  }

  await new Promise((r) => setTimeout(r, 4000));

  try {
    const info = await emailguard.getDomain(LADDER_IO_UUID);
    summarize("laddergroup.io", info as unknown as Record<string, unknown>);
  } catch (err) {
    const e = err as Error & { status?: number; body?: string };
    console.log(`GET FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
  }

  // ================================================
  // STEP 2: Other 4 — PATCH SPF/DKIM/DMARC then GET
  // ================================================
  console.log("\n=== OTHER LADDER DOMAINS PROBE ===");
  for (const [d, uuid] of Object.entries(OTHERS)) {
    console.log(`\n-- ${d} (${uuid}) --`);
    try {
      await emailguard.checkSpf(uuid);
      console.log("  SPF PATCH: OK");
    } catch (err) {
      const e = err as Error & { status?: number; body?: string };
      console.log(`  SPF PATCH FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
    }
    try {
      await emailguard.checkDkim(uuid, ["google"]);
      console.log("  DKIM PATCH: OK");
    } catch (err) {
      const e = err as Error & { status?: number; body?: string };
      console.log(`  DKIM PATCH FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
    }
    try {
      await emailguard.checkDmarc(uuid);
      console.log("  DMARC PATCH: OK");
    } catch (err) {
      const e = err as Error & { status?: number; body?: string };
      console.log(`  DMARC PATCH FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
    }
  }

  await new Promise((r) => setTimeout(r, 4000));

  for (const [d, uuid] of Object.entries(OTHERS)) {
    try {
      const info = await emailguard.getDomain(uuid);
      summarize(d, info as unknown as Record<string, unknown>);
    } catch (err) {
      const e = err as Error & { status?: number; body?: string };
      console.log(`\n${d}: GET FAILED status=${e.status} body=${e.body?.slice(0, 200)}`);
    }
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
