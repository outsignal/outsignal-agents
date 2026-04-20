/**
 * BL-104 QA — independent wire verification for EB campaign 92 on
 * 1210-solutions. Deliberately NOT reusing the dev's _bl104-verify.ts
 * script. Parallel logic, written from scratch, asserting the same
 * invariants the dev claimed: zero trailing legal/geo/bracket residue
 * on company names, Sonnic present and plain, no empty strings, and
 * {COMPANY} token preserved at storage.
 *
 * Throwaway — underscore-prefixed, will not be committed.
 *
 * Monty QA (Opus 4.6) — BL-104 review cycle.
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "1210-solutions";
const EB_CAMPAIGN_ID = 92;

// Legal suffixes (case-insensitive, with optional trailing dot).
const LEGAL_TRAILING = [
  "Limited",
  "Incorporated",
  "Corporation",
  "Pty Ltd",
  "GmbH",
  "LLC",
  "LLP",
  "PLC",
  "Ltd",
  "Inc",
  "Corp",
  "SA",
  "BV",
  "NV",
  "AG",
  "SE",
  "KG",
  "Pty",
  "PBC",
  "Co",
  "Company",
  "SARL",
  "SpA",
];

const GEO_TRAILING = [
  "United Kingdom",
  "United States",
  "Northern Ireland",
  "South Africa",
  "New Zealand",
  "Hong Kong",
  "Worldwide",
  "International",
  "Singapore",
  "Australia",
  "Scotland",
  "Germany",
  "Ireland",
  "Canada",
  "England",
  "Europe",
  "France",
  "LATAM",
  "Global",
  "China",
  "EMEA",
  "APAC",
  "India",
  "Italy",
  "Japan",
  "Spain",
  "Wales",
  "USA",
  "UAE",
  "UK",
  "US",
  "NZ",
  "EU",
];

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

function trailingLegal(name: string): string | null {
  for (const s of LEGAL_TRAILING) {
    const re = new RegExp(`\\s+${esc(s)}\\.?$`, "i");
    if (re.test(name)) return s;
  }
  return null;
}

function trailingGeo(name: string): string | null {
  for (const s of GEO_TRAILING) {
    const re = new RegExp(`\\s+${esc(s)}\\.?$`, "i");
    if (re.test(name)) return s;
  }
  return null;
}

function trailingRoundBracket(name: string): boolean {
  return /^(.*?\S)\s*\([^)]+\)\s*$/.test(name);
}

async function main() {
  const ws = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { apiToken: true },
  });
  if (!ws?.apiToken) {
    throw new Error(`workspace ${WORKSPACE_SLUG} missing apiToken`);
  }
  const client = new EmailBisonClient(ws.apiToken);

  console.log(`\n==== BL-104 QA — independent wire verification ====`);
  console.log(`Workspace: ${WORKSPACE_SLUG}  EB campaign: ${EB_CAMPAIGN_ID}\n`);

  // ---- Fetch all leads paginated ----
  const allLeads: Array<{ id: number; email: string; company: string | null }> =
    [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await client.getCampaignLeads(EB_CAMPAIGN_ID, page, 100);
    for (const lead of res.data) {
      allLeads.push({
        id: lead.id,
        email: lead.email,
        company: (lead.company as string | undefined) ?? null,
      });
    }
    if (page >= res.meta.last_page) break;
    page++;
  }
  console.log(`Fetched ${allLeads.length} leads (expected 44).`);
  if (allLeads.length !== 44) {
    console.warn(`WARNING: expected 44 leads, got ${allLeads.length}`);
  }

  // ---- Scan for violations ----
  const emptyCompany: typeof allLeads = [];
  const legalViolations: Array<{
    email: string;
    company: string;
    match: string;
  }> = [];
  const geoViolations: Array<{
    email: string;
    company: string;
    match: string;
  }> = [];
  const bracketViolations: Array<{ email: string; company: string }> = [];

  for (const lead of allLeads) {
    const c = lead.company ?? "";
    if (!c) {
      emptyCompany.push(lead);
      continue;
    }
    const l = trailingLegal(c);
    if (l) legalViolations.push({ email: lead.email, company: c, match: l });
    const g = trailingGeo(c);
    if (g) geoViolations.push({ email: lead.email, company: c, match: g });
    if (trailingRoundBracket(c))
      bracketViolations.push({ email: lead.email, company: c });
  }

  console.log(`\nViolation summary:`);
  console.log(`  trailing legal:   ${legalViolations.length}`);
  console.log(`  trailing geo:     ${geoViolations.length}`);
  console.log(`  trailing bracket: ${bracketViolations.length}`);
  console.log(`  empty company:    ${emptyCompany.length}`);

  if (legalViolations.length) {
    console.log(`\nLEGAL VIOLATIONS:`);
    for (const v of legalViolations.slice(0, 20))
      console.log(`  ${v.email}  '${v.company}'  (trailing '${v.match}')`);
  }
  if (geoViolations.length) {
    console.log(`\nGEO VIOLATIONS:`);
    for (const v of geoViolations.slice(0, 20))
      console.log(`  ${v.email}  '${v.company}'  (trailing '${v.match}')`);
  }
  if (bracketViolations.length) {
    console.log(`\nBRACKET VIOLATIONS:`);
    for (const v of bracketViolations.slice(0, 20))
      console.log(`  ${v.email}  '${v.company}'`);
  }
  if (emptyCompany.length) {
    console.log(`\nEMPTY COMPANY (wire):`);
    for (const v of emptyCompany.slice(0, 20)) console.log(`  ${v.email}`);
  }

  // ---- Sonnic check ----
  console.log(`\n---- Sonnic check ----`);
  const sonnic = allLeads.filter((l) =>
    (l.company ?? "").toLowerCase().includes("sonnic"),
  );
  if (sonnic.length === 0) {
    console.log(`Sonnic NOT present in campaign leads.`);
  } else {
    for (const s of sonnic) {
      console.log(`  ${s.email}  company='${s.company}'`);
      if (s.company !== "Sonnic") {
        console.log(`  ^ EXPECTED 'Sonnic' plain, got '${s.company}'`);
      }
    }
  }

  // ---- DB source check for Sonnic + sample of 15 wire names ----
  console.log(`\n---- DB source cross-check (Person.company + companyDomain) ----`);
  const sampleEmails = allLeads.slice(0, 15).map((l) => l.email);
  if (sonnic.length > 0) {
    for (const s of sonnic) if (!sampleEmails.includes(s.email)) sampleEmails.push(s.email);
  }
  const dbPeople = await prisma.person.findMany({
    where: { email: { in: sampleEmails } },
    select: {
      email: true,
      company: true,
      companyDomain: true,
    },
  });
  const dbMap = new Map<string, { company: string | null; companyDomain: string | null }>();
  for (const p of dbPeople)
    dbMap.set(p.email ?? "", { company: p.company, companyDomain: p.companyDomain });

  const wireMap = new Map<string, string | null>();
  for (const l of allLeads) wireMap.set(l.email, l.company);

  let nullDomainCount = 0;
  console.log(
    `\n  ${"email".padEnd(44)} ${"db.company".padEnd(42)} ${"db.companyDomain".padEnd(28)} wire.company`,
  );
  for (const email of sampleEmails) {
    const db = dbMap.get(email);
    const wire = wireMap.get(email);
    if (db?.companyDomain == null) nullDomainCount++;
    console.log(
      `  ${email.padEnd(44)} ${String(db?.company ?? "NULL").padEnd(42)} ${String(db?.companyDomain ?? "NULL").padEnd(28)} ${String(wire ?? "NULL")}`,
    );
  }
  console.log(`\n  Null companyDomain count in sample: ${nullDomainCount}/${sampleEmails.length}`);

  // ---- Sequence steps — {COMPANY} token preservation ----
  console.log(`\n---- Sequence step {COMPANY} token storage check ----`);
  const steps = await client.getSequenceSteps(EB_CAMPAIGN_ID);
  console.log(`Fetched ${steps.length} sequence steps.`);
  for (const s of steps.slice(0, 3)) {
    const body = (s as unknown as { body?: string; text?: string; email_body?: string }).body ??
      (s as unknown as { text?: string }).text ??
      (s as unknown as { email_body?: string }).email_body ??
      "";
    const subject = (s as unknown as { subject?: string; email_subject?: string }).subject ??
      (s as unknown as { email_subject?: string }).email_subject ??
      "";
    const hasCompanyToken = /\{COMPANY\}/.test(body) || /\{COMPANY\}/.test(subject);
    console.log(
      `  step order=${(s as unknown as { order?: number; position?: number }).order ?? (s as unknown as { position?: number }).position}  token={COMPANY}? ${hasCompanyToken}  body.len=${body.length}`,
    );
    if (!hasCompanyToken) {
      console.log(`    subject: ${subject.slice(0, 140)}`);
      console.log(`    body: ${body.slice(0, 300)}`);
    }
  }

  // ---- Final verdict ----
  const totalViolations =
    legalViolations.length + geoViolations.length + bracketViolations.length;
  console.log(`\n==== FINAL QA VERDICT ====`);
  console.log(`Total wire violations: ${totalViolations}`);
  console.log(`Empty companies: ${emptyCompany.length}`);
  console.log(
    `Sonnic status: ${sonnic.length === 0 ? "NOT PRESENT" : sonnic.every((s) => s.company === "Sonnic") ? "PLAIN 'Sonnic' ✓" : "PRESENT BUT NOT PLAIN ✗"}`,
  );
  console.log(
    `Result: ${totalViolations === 0 ? "CLEAN ✓" : "VIOLATIONS FOUND ✗"}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
