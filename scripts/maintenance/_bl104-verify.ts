/**
 * BL-104 (2026-04-16) — verification script for the post-polish canary
 * re-stage. Fetches all 44 deployed leads from EB 92 via the established
 * EmailBisonClient (paginated), asserts NO trailing LEGAL/GEO/bracket
 * residue on any company name, greps specifically for 'Sonnic' and 'C4SS'
 * (unit-test-only fallback if not in fixture), logs 15 before/after pairs
 * with the raw Person.company read from the DB, and re-fetches sequence
 * steps to confirm {COMPANY} token preserved at storage.
 *
 * Throwaway — underscore prefix, kept untracked.
 *
 * HARDCODED scope:
 *   - EmailBison campaign ID 92 (post-BL-104 re-stage, 1210-solutions)
 *   - Outsignal Campaign cmneqixpv0001p8710bov1fga
 */

import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

const WORKSPACE_SLUG = "1210-solutions";
const EB_CAMPAIGN_ID = 92;
const OUTSIGNAL_CAMPAIGN_ID = "cmneqixpv0001p8710bov1fga";

// Mirror the suffix sets from company-normaliser.ts — shape-check on wire.
// Deliberately duplicated here so the verification is independent of the
// module under test (BL-093 precedent: validator must not query its own
// output).
const LEGAL_SUFFIXES = [
  "Incorporated",
  "Corporation",
  "S.A.R.L.",
  "Pty Ltd",
  "Limited",
  "Company",
  "S.p.A.",
  "L.L.C.",
  "L.L.P.",
  "P.L.C.",
  "GmbH",
  "SARL",
  "S.A.",
  "B.V.",
  "N.V.",
  "A.G.",
  "PBC",
  "PLC",
  "LLP",
  "LLC",
  "Pty",
  "Inc",
  "Ltd",
  "Corp",
  "SpA",
  "A/S",
  "Co",
  "SE",
  "OY",
  "AS",
  "BV",
  "NV",
  "AG",
  "SA",
  "KG",
];
const GEO_SUFFIXES = [
  "Northern Ireland",
  "United Kingdom",
  "United States",
  "South Africa",
  "New Zealand",
  "Hong Kong",
  "U.S.A.",
  "U.K.",
  "U.S.",
  "Worldwide",
  "International",
  "Singapore",
  "Australia",
  "Americas",
  "European",
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
  "Netherlands",
  "USA",
  "UAE",
  "EU",
  "US",
  "UK",
  "NZ",
];

function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
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

function hasTrailingBracket(name: string): boolean {
  // Round parens only — square brackets are intentionally preserved.
  return /^(.*?\S)\s*\([^)]+\)\s*$/.test(name);
}

async function main() {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
    select: { apiToken: true },
  });
  if (!workspace?.apiToken) {
    throw new Error(`Workspace '${WORKSPACE_SLUG}' missing / no apiToken`);
  }
  const client = new EmailBisonClient(workspace.apiToken);

  console.log(`\n=== BL-104 verification — EB campaign ${EB_CAMPAIGN_ID} ===`);

  // -------------------------------------------------------------------------
  // Part 1 — Fetch all leads (paginated) and assert zero residue
  // -------------------------------------------------------------------------
  console.log("\n=== PART 1: lead company normalisation audit ===");
  const allLeads: Array<{ id: number; email: string; company?: string }> = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await client.getCampaignLeads(EB_CAMPAIGN_ID, page, 100);
    for (const lead of res.data) {
      allLeads.push({
        id: lead.id,
        email: lead.email,
        company: lead.company,
      });
    }
    if (page >= res.meta.last_page) break;
    page++;
  }
  console.log(`Fetched ${allLeads.length} leads (expected 44).`);

  const residueFindings: Array<{
    email: string;
    company: string;
    violation: string;
  }> = [];
  for (const lead of allLeads) {
    const company = lead.company ?? "";
    if (!company) continue; // null/empty ok (domain-only lead)
    const legal = hasTrailingLegal(company);
    if (legal) {
      residueFindings.push({
        email: lead.email,
        company,
        violation: `trailing LEGAL '${legal}'`,
      });
      continue;
    }
    const geo = hasTrailingGeo(company);
    if (geo) {
      residueFindings.push({
        email: lead.email,
        company,
        violation: `trailing GEO '${geo}'`,
      });
      continue;
    }
    if (hasTrailingBracket(company)) {
      residueFindings.push({
        email: lead.email,
        company,
        violation: `trailing round-bracket group`,
      });
      continue;
    }
  }

  if (residueFindings.length === 0) {
    console.log(
      `[OK] Zero trailing LEGAL/GEO/bracket residue across ${allLeads.length} leads.`,
    );
  } else {
    console.log(
      `[FAIL] ${residueFindings.length} residue violations found:`,
    );
    for (const f of residueFindings) {
      console.log(
        `  email=${f.email}  company='${f.company}'  violation=${f.violation}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Part 2 — Grep for specific proof cases ('Sonnic', 'C4SS')
  // -------------------------------------------------------------------------
  console.log("\n=== PART 2: proof-case greps ===");
  const sonnicMatches = allLeads.filter((l) =>
    l.company?.toLowerCase().includes("sonnic"),
  );
  if (sonnicMatches.length > 0) {
    console.log(`[SONNIC] ${sonnicMatches.length} matches:`);
    for (const m of sonnicMatches) {
      const hasDomainTruncation =
        m.company === "Sonnic" ||
        m.company === "Sonnic "; /* trailing whitespace check just in case */
      console.log(
        `  email=${m.email}  company='${m.company}'  domain-truncated=${hasDomainTruncation}`,
      );
    }
  } else {
    console.log(
      `[SONNIC] NOT IN FIXTURE — domain rule verified via unit tests only.`,
    );
  }

  const c4ssMatches = allLeads.filter((l) =>
    l.company?.toLowerCase().includes("c4ss"),
  );
  if (c4ssMatches.length > 0) {
    console.log(`[C4SS] ${c4ssMatches.length} matches:`);
    for (const m of c4ssMatches) {
      const isPureC4SS = m.company === "C4SS";
      console.log(
        `  email=${m.email}  company='${m.company}'  pure-c4ss=${isPureC4SS}`,
      );
    }
  } else {
    console.log(
      `[C4SS] NOT IN FIXTURE — bracket rule verified via unit tests only.`,
    );
  }

  // -------------------------------------------------------------------------
  // Part 3 — 15 before/after pairs from DB vs wire
  // -------------------------------------------------------------------------
  console.log("\n=== PART 3: 15 before/after pairs (DB vs EB wire) ===");

  // Join EB leads to DB Person rows via email — scoped to TargetList of the
  // canary campaign. The Person.company column is the raw legal-name value;
  // the EB lead.company is the post-normalisation wire value.
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: OUTSIGNAL_CAMPAIGN_ID },
    select: { targetListId: true },
  });
  if (!campaign.targetListId) {
    throw new Error(
      `Campaign ${OUTSIGNAL_CAMPAIGN_ID} has no targetListId — cannot read Person rows.`,
    );
  }

  const tlps = await prisma.targetListPerson.findMany({
    where: { listId: campaign.targetListId },
    include: {
      person: {
        select: {
          id: true,
          email: true,
          company: true,
          companyDomain: true,
        },
      },
    },
  });

  // Build pairs. Prefer categories: Sonnic (if present), C4SS (if present),
  // any '&' brand, legal-only, already-clean, geo-only, domain-truncated
  // otherwise. Fall back to first-N if categories are thin.
  const emailToEbLead = new Map<string, string>();
  for (const l of allLeads) {
    if (l.company !== undefined) emailToEbLead.set(l.email, l.company ?? "");
  }

  const pairs: Array<{
    email: string;
    dbCompany: string | null;
    dbDomain: string | null;
    ebCompany: string;
    category: string;
  }> = [];
  const seen = new Set<string>();

  function pushPair(
    tlp: (typeof tlps)[number],
    category: string,
  ) {
    if (seen.has(tlp.person.email!)) return;
    const ebCompany = emailToEbLead.get(tlp.person.email!);
    if (ebCompany === undefined) return; // not in the EB fixture
    seen.add(tlp.person.email!);
    pairs.push({
      email: tlp.person.email!,
      dbCompany: tlp.person.company,
      dbDomain: tlp.person.companyDomain,
      ebCompany,
      category,
    });
  }

  // Category: Sonnic
  for (const tlp of tlps) {
    if (pairs.length >= 15) break;
    if (tlp.person.company?.toLowerCase().includes("sonnic")) {
      pushPair(tlp, "domain-truncated (sonnic)");
    }
  }
  // Category: C4SS
  for (const tlp of tlps) {
    if (pairs.length >= 15) break;
    if (tlp.person.company?.toLowerCase().includes("c4ss")) {
      pushPair(tlp, "bracket-stripped (c4ss)");
    }
  }
  // Category: & Co / & Company
  for (const tlp of tlps) {
    if (pairs.length >= 15) break;
    if (/\s&\s(Co|Company)\b/i.test(tlp.person.company ?? "")) {
      pushPair(tlp, "ampersand-preserved");
    }
  }
  // Category: trailing LEGAL-only
  for (const tlp of tlps) {
    if (pairs.length >= 15) break;
    const c = tlp.person.company ?? "";
    if (hasTrailingLegal(c) && !hasTrailingGeo(c) && !hasTrailingBracket(c)) {
      pushPair(tlp, "legal-only");
    }
  }
  // Category: trailing GEO-only
  for (const tlp of tlps) {
    if (pairs.length >= 15) break;
    const c = tlp.person.company ?? "";
    if (hasTrailingGeo(c) && !hasTrailingLegal(c) && !hasTrailingBracket(c)) {
      pushPair(tlp, "geo-only");
    }
  }
  // Category: trailing bracket-only
  for (const tlp of tlps) {
    if (pairs.length >= 15) break;
    const c = tlp.person.company ?? "";
    if (hasTrailingBracket(c) && !hasTrailingLegal(c) && !hasTrailingGeo(c)) {
      pushPair(tlp, "bracket-only");
    }
  }
  // Category: already-clean
  for (const tlp of tlps) {
    if (pairs.length >= 15) break;
    const c = tlp.person.company ?? "";
    if (!hasTrailingLegal(c) && !hasTrailingGeo(c) && !hasTrailingBracket(c)) {
      pushPair(tlp, "already-clean");
    }
  }
  // Fall back: any remaining
  for (const tlp of tlps) {
    if (pairs.length >= 15) break;
    pushPair(tlp, "fallback");
  }

  console.log(`\nPairs collected: ${pairs.length} / 15`);
  console.log("\n| # | Email | DB (raw) | Domain | EB (wire) | Category |");
  console.log("|---|-------|----------|--------|-----------|----------|");
  pairs.forEach((p, i) => {
    console.log(
      `| ${i + 1} | ${p.email} | '${p.dbCompany ?? "(null)"}' | ${p.dbDomain ?? "(null)"} | '${p.ebCompany}' | ${p.category} |`,
    );
  });

  // -------------------------------------------------------------------------
  // Part 4 — Sequence steps: {COMPANY} token preserved at storage
  // -------------------------------------------------------------------------
  console.log("\n=== PART 4: sequence-step {COMPANY} token preserved ===");
  const seqSteps = await client.getSequenceSteps(EB_CAMPAIGN_ID);
  console.log(`Fetched ${seqSteps.length} sequence steps (expected 3).`);
  let step1HasCompany = false;
  for (const step of seqSteps) {
    // EB v1.1 uses 'position' + 'subject' + 'body'; SequenceStep typing may
    // also expose legacy 'order' / 'email_subject' / 'email_body' via
    // defensive fallbacks in the client. Read all candidates.
    const stepAny = step as {
      order?: number;
      position?: number;
      email_subject?: string;
      subject?: string;
      email_body?: string;
      body?: string;
    };
    const pos = stepAny.position ?? stepAny.order;
    const subj = stepAny.subject ?? stepAny.email_subject ?? "";
    const body = stepAny.body ?? stepAny.email_body ?? "";
    const hasCompany = body.includes("{COMPANY}");
    console.log(
      `  step position=${pos} subject='${subj}' has-{COMPANY}=${hasCompany}`,
    );
    if (pos === 1 && hasCompany) step1HasCompany = true;
  }
  if (step1HasCompany) {
    console.log(`[OK] Step 1 body contains literal {COMPANY} token.`);
  } else {
    console.log(`[WARN] Step 1 body does NOT contain {COMPANY} token.`);
  }

  // -------------------------------------------------------------------------
  // Final summary
  // -------------------------------------------------------------------------
  console.log("\n=== SUMMARY ===");
  console.log(`leads fetched: ${allLeads.length}`);
  console.log(`residue violations: ${residueFindings.length}`);
  console.log(`sonnic matches: ${sonnicMatches.length}`);
  console.log(`c4ss matches: ${c4ssMatches.length}`);
  console.log(`pairs logged: ${pairs.length}`);
  console.log(`seq steps: ${seqSteps.length}`);
  console.log(`step 1 {COMPANY} preserved: ${step1HasCompany}`);

  const pass =
    allLeads.length === 44 &&
    residueFindings.length === 0 &&
    seqSteps.length === 3 &&
    step1HasCompany;
  console.log(`\nVERIFICATION: ${pass ? "PASS" : "FAIL"}`);
  if (!pass) process.exit(1);
}

main()
  .catch((err) => {
    console.error("[bl104-verify] FATAL:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
