/**
 * BL-108 / BL-107 QA verification (2026-04-16) — monty-qa independent check.
 *
 * Fetches EB campaign 97 (Green List Priority) for workspace '1210-solutions':
 *   1) getCampaignById(97) — confirm status=draft, name matches
 *   2) paginated getCampaignLeads(97) — count leads, expect 579
 *   3) spot-check 5 random leads for {UPPERCASE} residue + trailing legal/geo
 *   4) confirm sequence step count = 3
 *
 * Throwaway, underscore-prefixed, untracked. Pattern: _bl104-verify.ts.
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "1210-solutions";
const EB_CAMPAIGN_ID = 97;
const EXPECTED_LEAD_COUNT = 579;
const EXPECTED_NAME_FRAGMENT = "Green List Priority";

// Mirror suffix sets from company-normaliser — independent of SUT.
const LEGAL_SUFFIXES = [
  "Incorporated",
  "Corporation",
  "Pty Ltd",
  "Limited",
  "Company",
  "L.L.C.",
  "L.L.P.",
  "P.L.C.",
  "GmbH",
  "SARL",
  "PLC",
  "LLP",
  "LLC",
  "Inc",
  "Ltd",
  "Corp",
  "Co",
];
const GEO_SUFFIXES = [
  "United Kingdom",
  "United States",
  "Scotland",
  "England",
  "Wales",
  "Ireland",
  "USA",
  "UK",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
function hasTrailingLegal(name: string): string | null {
  for (const s of LEGAL_SUFFIXES) {
    const re = new RegExp(`\\s+${escapeRegex(s)}\\.?$`, "i");
    if (re.test(name)) return s;
  }
  return null;
}
function hasTrailingGeo(name: string): string | null {
  for (const s of GEO_SUFFIXES) {
    const re = new RegExp(`\\s+${escapeRegex(s)}\\.?$`, "i");
    if (re.test(name)) return s;
  }
  return null;
}
function hasUppercaseTokenResidue(s: string): boolean {
  // Look for anything resembling {FIRSTNAME}/{COMPANYNAME}/etc. merge tokens.
  return /\{[A-Z_]+\}/.test(s);
}

async function main() {
  const ws = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { apiToken: true },
  });
  if (!ws?.apiToken) {
    throw new Error(`Workspace '${WORKSPACE_SLUG}' not found / no apiToken`);
  }
  const client = new EmailBisonClient(ws.apiToken);

  console.log(
    `\n=== BL-108/107 QA verification — EB campaign ${EB_CAMPAIGN_ID} / workspace ${WORKSPACE_SLUG} ===`,
  );

  // ---------------------------------------------------------------------
  // 1. Campaign detail
  // ---------------------------------------------------------------------
  console.log("\n[1] getCampaignById");
  const detail = await client.getCampaignById(EB_CAMPAIGN_ID);
  if (!detail) {
    console.log(`  FAIL: getCampaignById(${EB_CAMPAIGN_ID}) returned null`);
    process.exit(2);
  }
  console.log(
    `  id=${detail.id}  name='${detail.name}'  status='${detail.status}'`,
  );
  const nameOk = (detail.name ?? "").includes(EXPECTED_NAME_FRAGMENT);
  const statusOk = (detail.status ?? "").toLowerCase() === "draft";
  console.log(
    `  name-match=${nameOk}  status-draft=${statusOk}`,
  );

  // ---------------------------------------------------------------------
  // 2. Paginated lead count
  // ---------------------------------------------------------------------
  console.log("\n[2] getCampaignLeads — paginated");
  const allLeads: Array<{ id: number; email: string; company?: string; first_name?: string; last_name?: string; job_title?: string }> = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await client.getCampaignLeads(EB_CAMPAIGN_ID, page, 100);
    for (const lead of res.data as unknown as Array<{
      id: number;
      email: string;
      company?: string;
      first_name?: string;
      last_name?: string;
      job_title?: string;
    }>) {
      allLeads.push({
        id: lead.id,
        email: lead.email,
        company: lead.company,
        first_name: lead.first_name,
        last_name: lead.last_name,
        job_title: lead.job_title,
      });
    }
    console.log(
      `  page=${page}  size=${res.data.length}  meta.last_page=${res.meta.last_page}  running_total=${allLeads.length}`,
    );
    if (page >= res.meta.last_page) break;
    page++;
    if (page > 50) {
      console.log("  ABORT: > 50 pages, something is wrong");
      break;
    }
  }
  const countOk = allLeads.length === EXPECTED_LEAD_COUNT;
  console.log(
    `  actual=${allLeads.length}  expected=${EXPECTED_LEAD_COUNT}  match=${countOk}`,
  );

  // ---------------------------------------------------------------------
  // 3. Spot-check 5 random leads
  // ---------------------------------------------------------------------
  console.log("\n[3] spot-check 5 random leads for normaliser + token residue");
  const sample: typeof allLeads = [];
  const used = new Set<number>();
  while (sample.length < Math.min(5, allLeads.length)) {
    const i = Math.floor(Math.random() * allLeads.length);
    if (!used.has(i)) {
      used.add(i);
      sample.push(allLeads[i]);
    }
  }
  const residue: Array<{ lead: typeof allLeads[number]; issue: string }> = [];
  for (const l of sample) {
    const company = l.company ?? "";
    const firstName = l.first_name ?? "";
    const lastName = l.last_name ?? "";
    const jobTitle = l.job_title ?? "";
    console.log(
      `  email=${l.email}  company='${company}'  first='${firstName}'  last='${lastName}'  title='${jobTitle}'`,
    );
    const legal = hasTrailingLegal(company);
    if (legal) residue.push({ lead: l, issue: `trailing LEGAL '${legal}'` });
    const geo = hasTrailingGeo(company);
    if (geo) residue.push({ lead: l, issue: `trailing GEO '${geo}'` });
    for (const [k, v] of Object.entries({ company, firstName, lastName, jobTitle })) {
      if (hasUppercaseTokenResidue(v)) {
        residue.push({ lead: l, issue: `{TOKEN} residue in ${k}: '${v}'` });
      }
    }
  }
  if (residue.length === 0) {
    console.log("  OK — no residue in 5-lead spot check");
  } else {
    console.log(`  FAIL — ${residue.length} residue findings:`);
    for (const r of residue) {
      console.log(`    ${r.lead.email}: ${r.issue}`);
    }
  }

  // ---------------------------------------------------------------------
  // 4. Sequence step count
  // ---------------------------------------------------------------------
  console.log("\n[4] sequence step count");
  const steps = await client.getSequenceSteps(EB_CAMPAIGN_ID);
  console.log(`  step_count=${steps.length}  expected=3  match=${steps.length === 3}`);
  if (steps.length > 0) {
    for (const s of steps) {
      console.log(
        `    step ${(s as unknown as { position: number }).position}  subject='${(s as unknown as { subject: string }).subject}'  delay_days=${(s as unknown as { delay_days: number }).delay_days}`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------
  console.log("\n=== SUMMARY ===");
  console.log(`  name_match=${nameOk}`);
  console.log(`  status_draft=${statusOk}`);
  console.log(`  lead_count=${allLeads.length === EXPECTED_LEAD_COUNT ? "PASS" : "FAIL"} (${allLeads.length} / ${EXPECTED_LEAD_COUNT})`);
  console.log(`  spot_check_clean=${residue.length === 0 ? "PASS" : "FAIL"}`);
  console.log(`  step_count_three=${steps.length === 3 ? "PASS" : "FAIL"}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("VERIFICATION FAILED:", err);
  await prisma.$disconnect();
  process.exit(1);
});
