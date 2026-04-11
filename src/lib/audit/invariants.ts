/**
 * System invariants audit — shared library.
 *
 * Produces a per-workspace pass/fail report for the data integrity
 * invariants that keep every client on the same quality baseline:
 *
 *   INV1 — Email integrity: every Person.email is NULL or verified-valid.
 *          No placeholders, no role emails, no malformed strings.
 *
 *   INV2 — Scoring coverage: every PersonWorkspace has icpScore NOT NULL.
 *
 *   INV3 — Staging path: every Person has a corresponding DiscoveredPerson
 *          archive row (linked via DiscoveredPerson.personId).
 *
 *   INV4 — Name integrity: every Person has at least one of firstName
 *          or lastName, and neither is a junk literal (test/demo/sample/
 *          unknown/-/empty).
 *
 *   INV5 — Job title integrity: jobTitle is either NULL or a real title.
 *          Not a salutation (Mr/Ms/Dr), not a single literal like "no"
 *          or "unknown", not a plural job-family string like "Warehouse
 *          Managers". 2-char known exceptions (HR, QA) are allowlisted.
 *
 *   INV6 — Company domain integrity: companyDomain is NULL or a bare
 *          domain (no http:// prefix, no path, no whitespace, matches
 *          a standard TLD shape).
 *
 *   INV7 — Contactability: every Person has at least one of email or
 *          linkedinUrl. A lead with neither is uncontactable and should
 *          never have reached the Person table.
 *
 * Excluded workspaces (currently: outsignal) are shown in the per-workspace
 * results but DO NOT contribute to the overall PASS/FAIL verdict or totals.
 *
 * Used by:
 *   - scripts/cli/audit-invariants.ts (interactive CLI wrapper)
 *   - trigger/daily-invariant-audit.ts (scheduled daily report)
 */

import { prisma } from "@/lib/db";

/**
 * Workspaces deliberately excluded from invariant totals.
 *
 * 2026-04-11 — outsignal: Per-campaign ICP model. Outsignal runs per-client
 * campaigns with different sub-ICPs per target list. A single workspace
 * icpCriteriaPrompt cannot capture this. Architectural work needed to move
 * scoring from workspace-scoped to campaign- or list-scoped. Parked until
 * the per-campaign scoring model is designed.
 */
export const EXCLUDED_WORKSPACES = new Set<string>(["outsignal"]);

export interface WorkspaceInvariantResult {
  workspace: string;
  excluded: boolean;
  totalLeads: number;
  inv1Violations: number;
  inv1Pass: boolean;
  inv2Violations: number;
  inv2Pass: boolean;
  inv3Violations: number;
  inv3Pass: boolean;
  inv4Violations: number;
  inv4Pass: boolean;
  inv5Violations: number;
  inv5Pass: boolean;
  inv6Violations: number;
  inv6Pass: boolean;
  inv7Violations: number;
  inv7Pass: boolean;
}

export interface InvariantAuditResult {
  generatedAt: string;
  perWorkspace: WorkspaceInvariantResult[];
  totals: {
    totalLeads: number;
    inv1Violations: number;
    inv2Violations: number;
    inv3Violations: number;
    inv4Violations: number;
    inv5Violations: number;
    inv6Violations: number;
    inv7Violations: number;
  };
  allPass: boolean;
}

/**
 * Run the full invariant audit against the live database.
 *
 * Read-only — runs four Prisma raw queries in parallel and aggregates the
 * per-workspace results. Safe to run against production.
 */
export async function runInvariantAudit(): Promise<InvariantAuditResult> {
  // INV1: placeholders, role emails, and malformed email strings.
  // "Valid" means: email is null, OR email matches a basic shape and does
  // not start with info@/sales@/contact@/hello@/admin@/noreply@, and is
  // not @discovery.internal / @discovered.local.
  const inv1Promise = prisma.$queryRawUnsafe<
    Array<{ workspace: string; violations: number }>
  >(`
    SELECT lw.workspace, COUNT(*)::int AS violations
    FROM "LeadWorkspace" lw
    INNER JOIN "Lead" l ON lw."leadId" = l.id
    WHERE l.email IS NOT NULL
      AND (
        l.email LIKE '%@discovery.internal%'
        OR l.email LIKE '%@discovered.local%'
        OR l.email LIKE 'info@%'
        OR l.email LIKE 'sales@%'
        OR l.email LIKE 'contact@%'
        OR l.email LIKE 'hello@%'
        OR l.email LIKE 'admin@%'
        OR l.email LIKE 'noreply@%'
        OR l.email LIKE 'no-reply@%'
        OR l.email NOT LIKE '%_@_%._%'
      )
    GROUP BY lw.workspace
  `);

  // INV2: PersonWorkspace rows with NULL icpScore.
  const inv2Promise = prisma.$queryRawUnsafe<
    Array<{ workspace: string; violations: number }>
  >(`
    SELECT workspace, COUNT(*)::int AS violations
    FROM "LeadWorkspace"
    WHERE "icpScore" IS NULL
    GROUP BY workspace
  `);

  // INV3: Person rows without a linked DiscoveredPerson archive row.
  // A Person is "archived" if any DiscoveredPerson.personId matches its id.
  // Bypass paths (EmailBison sync, Clay imports, manual uploads) created
  // Person rows without writing DiscoveredPerson at all.
  const inv3Promise = prisma.$queryRawUnsafe<
    Array<{ workspace: string; violations: number }>
  >(`
    SELECT lw.workspace, COUNT(*)::int AS violations
    FROM "LeadWorkspace" lw
    INNER JOIN "Lead" l ON lw."leadId" = l.id
    LEFT JOIN "DiscoveredPerson" dp ON dp."personId" = l.id
    WHERE dp.id IS NULL
    GROUP BY lw.workspace
  `);

  // INV4: Name integrity. A lead with both firstName and lastName null is
  // unusable — no way to personalise outreach. Also catches junk literals
  // like "test"/"demo"/"sample"/"unknown" that some ingestion paths may
  // have let through.
  const inv4Promise = prisma.$queryRawUnsafe<
    Array<{ workspace: string; violations: number }>
  >(`
    SELECT lw.workspace, COUNT(*)::int AS violations
    FROM "LeadWorkspace" lw
    INNER JOIN "Lead" l ON lw."leadId" = l.id
    WHERE (
      (l."firstName" IS NULL AND l."lastName" IS NULL)
      OR LOWER(l."firstName") IN ('test','demo','sample','n/a','unknown','-')
      OR LOWER(l."lastName") IN ('test','demo','sample','n/a','unknown','-')
      OR l."firstName" = ''
      OR l."lastName" = ''
    )
    GROUP BY lw.workspace
  `);

  // INV5: Job title integrity. The jobTitle field is used in merge-tag
  // personalisation, so garbage titles produce broken outreach. Allows
  // NULL (nothing to render) but rejects:
  //   - Salutations (Mr/Ms/Dr)
  //   - Empty/dash/unknown literals
  //   - Plural job-family artefacts ("Warehouse Managers", etc.)
  //   - Strings shorter than 3 chars EXCEPT the allowlist of genuine
  //     2-char job families (HR, QA) which are real on Lime
  const inv5Promise = prisma.$queryRawUnsafe<
    Array<{ workspace: string; violations: number }>
  >(`
    SELECT lw.workspace, COUNT(*)::int AS violations
    FROM "LeadWorkspace" lw
    INNER JOIN "Lead" l ON lw."leadId" = l.id
    WHERE l."jobTitle" IS NOT NULL
      AND (
        LOWER(l."jobTitle") IN ('no','unknown','n/a','na','none','null','mr','ms','dr','mrs','miss','-','')
        OR (LENGTH(l."jobTitle") < 3 AND l."jobTitle" NOT IN ('HR','QA'))
        OR l."jobTitle" SIMILAR TO '%(Managers|Supervisors|Operators)$'
      )
    GROUP BY lw.workspace
  `);

  // INV6: Company domain integrity. The companyDomain field should be a
  // bare domain (e.g. "acme.com"), not a URL with scheme/path/query
  // ("https://www.acme.com/europe"). Full URLs in this field break the
  // crawl cache (wrong cache keys), break source-first enrichment (Prospeo
  // bulkEnrichByPersonId expects bare domains), and break any downstream
  // consumer that assumes a normalised domain shape.
  const inv6Promise = prisma.$queryRawUnsafe<
    Array<{ workspace: string; violations: number }>
  >(`
    SELECT lw.workspace, COUNT(*)::int AS violations
    FROM "LeadWorkspace" lw
    INNER JOIN "Lead" l ON lw."leadId" = l.id
    WHERE l."companyDomain" IS NOT NULL
      AND (
        l."companyDomain" !~ '^[a-z0-9][a-z0-9-]{0,62}(\\.[a-z0-9][a-z0-9-]{0,62})+$'
        OR l."companyDomain" LIKE '% %'
        OR l."companyDomain" LIKE 'http%'
        OR l."companyDomain" IN ('null','none','-','unknown')
      )
    GROUP BY lw.workspace
  `);

  // INV7: Contactability. Every lead in a workspace must have at least one
  // outreach channel available — either an email (for email campaigns) or
  // a LinkedIn URL (for LinkedIn outreach). A lead with neither is
  // uncontactable and shouldn't be occupying a Person row.
  const inv7Promise = prisma.$queryRawUnsafe<
    Array<{ workspace: string; violations: number }>
  >(`
    SELECT lw.workspace, COUNT(*)::int AS violations
    FROM "LeadWorkspace" lw
    INNER JOIN "Lead" l ON lw."leadId" = l.id
    WHERE l.email IS NULL
      AND l."linkedinUrl" IS NULL
    GROUP BY lw.workspace
  `);

  // Totals per workspace for context.
  const totalsPromise = prisma.$queryRawUnsafe<
    Array<{ workspace: string; total: number }>
  >(`
    SELECT workspace, COUNT(*)::int AS total
    FROM "LeadWorkspace"
    GROUP BY workspace
  `);

  const [inv1Rows, inv2Rows, inv3Rows, inv4Rows, inv5Rows, inv6Rows, inv7Rows, totalsRows] = await Promise.all([
    inv1Promise,
    inv2Promise,
    inv3Promise,
    inv4Promise,
    inv5Promise,
    inv6Promise,
    inv7Promise,
    totalsPromise,
  ]);

  const inv1Map = new Map(inv1Rows.map((r) => [r.workspace, r.violations]));
  const inv2Map = new Map(inv2Rows.map((r) => [r.workspace, r.violations]));
  const inv3Map = new Map(inv3Rows.map((r) => [r.workspace, r.violations]));
  const inv4Map = new Map(inv4Rows.map((r) => [r.workspace, r.violations]));
  const inv5Map = new Map(inv5Rows.map((r) => [r.workspace, r.violations]));
  const inv6Map = new Map(inv6Rows.map((r) => [r.workspace, r.violations]));
  const inv7Map = new Map(inv7Rows.map((r) => [r.workspace, r.violations]));

  const perWorkspace: WorkspaceInvariantResult[] = totalsRows
    .sort((a, b) => b.total - a.total)
    .map((r) => {
      const inv1 = inv1Map.get(r.workspace) ?? 0;
      const inv2 = inv2Map.get(r.workspace) ?? 0;
      const inv3 = inv3Map.get(r.workspace) ?? 0;
      const inv4 = inv4Map.get(r.workspace) ?? 0;
      const inv5 = inv5Map.get(r.workspace) ?? 0;
      const inv6 = inv6Map.get(r.workspace) ?? 0;
      const inv7 = inv7Map.get(r.workspace) ?? 0;
      return {
        workspace: r.workspace,
        excluded: EXCLUDED_WORKSPACES.has(r.workspace),
        totalLeads: r.total,
        inv1Violations: inv1,
        inv1Pass: inv1 === 0,
        inv2Violations: inv2,
        inv2Pass: inv2 === 0,
        inv3Violations: inv3,
        inv3Pass: inv3 === 0,
        inv4Violations: inv4,
        inv4Pass: inv4 === 0,
        inv5Violations: inv5,
        inv5Pass: inv5 === 0,
        inv6Violations: inv6,
        inv6Pass: inv6 === 0,
        inv7Violations: inv7,
        inv7Pass: inv7 === 0,
      };
    });

  // Totals exclude EXCLUDED_WORKSPACES so the overall PASS/FAIL verdict
  // reflects the state of workspaces we actively manage.
  const totals = perWorkspace
    .filter((r) => !r.excluded)
    .reduce(
      (acc, r) => ({
        totalLeads: acc.totalLeads + r.totalLeads,
        inv1Violations: acc.inv1Violations + r.inv1Violations,
        inv2Violations: acc.inv2Violations + r.inv2Violations,
        inv3Violations: acc.inv3Violations + r.inv3Violations,
        inv4Violations: acc.inv4Violations + r.inv4Violations,
        inv5Violations: acc.inv5Violations + r.inv5Violations,
        inv6Violations: acc.inv6Violations + r.inv6Violations,
        inv7Violations: acc.inv7Violations + r.inv7Violations,
      }),
      {
        totalLeads: 0,
        inv1Violations: 0,
        inv2Violations: 0,
        inv3Violations: 0,
        inv4Violations: 0,
        inv5Violations: 0,
        inv6Violations: 0,
        inv7Violations: 0,
      },
    );

  const allPass =
    totals.inv1Violations === 0 &&
    totals.inv2Violations === 0 &&
    totals.inv3Violations === 0 &&
    totals.inv4Violations === 0 &&
    totals.inv5Violations === 0 &&
    totals.inv6Violations === 0 &&
    totals.inv7Violations === 0;

  return {
    generatedAt: new Date().toISOString(),
    perWorkspace,
    totals,
    allPass,
  };
}

/**
 * Render a human-readable invariant audit table.
 * Used by the CLI script and the Slack message for the daily cron.
 *
 * Columns: workspace · total · INV1..INV7 (each column is ✓ or ✗ N)
 */
export function renderAuditTable(audit: InvariantAuditResult): string {
  const rows: string[] = [];
  const headerCols = [
    "workspace".padEnd(24),
    "total".padStart(7),
    "INV1".padStart(6),
    "INV2".padStart(8),
    "INV3".padStart(8),
    "INV4".padStart(6),
    "INV5".padStart(6),
    "INV6".padStart(6),
    "INV7".padStart(6),
  ];
  rows.push(headerCols.join(""));
  rows.push("-".repeat(77));

  const fmt = (pass: boolean, count: number, width: number): string =>
    pass ? "✓".padStart(width) : (`✗ ${count}`).padStart(width);

  for (const r of audit.perWorkspace) {
    const prefix = r.excluded ? "[x] " : "    ";
    rows.push(
      prefix +
        r.workspace.padEnd(20) +
        String(r.totalLeads).padStart(7) +
        fmt(r.inv1Pass, r.inv1Violations, 6) +
        fmt(r.inv2Pass, r.inv2Violations, 8) +
        fmt(r.inv3Pass, r.inv3Violations, 8) +
        fmt(r.inv4Pass, r.inv4Violations, 6) +
        fmt(r.inv5Pass, r.inv5Violations, 6) +
        fmt(r.inv6Pass, r.inv6Violations, 6) +
        fmt(r.inv7Pass, r.inv7Violations, 6),
    );
  }
  rows.push("-".repeat(77));
  rows.push(
    "TOTAL (active)".padEnd(24) +
      String(audit.totals.totalLeads).padStart(7) +
      fmt(audit.totals.inv1Violations === 0, audit.totals.inv1Violations, 6) +
      fmt(audit.totals.inv2Violations === 0, audit.totals.inv2Violations, 8) +
      fmt(audit.totals.inv3Violations === 0, audit.totals.inv3Violations, 8) +
      fmt(audit.totals.inv4Violations === 0, audit.totals.inv4Violations, 6) +
      fmt(audit.totals.inv5Violations === 0, audit.totals.inv5Violations, 6) +
      fmt(audit.totals.inv6Violations === 0, audit.totals.inv6Violations, 6) +
      fmt(audit.totals.inv7Violations === 0, audit.totals.inv7Violations, 6),
  );
  rows.push("");
  rows.push(`OVERALL: ${audit.allPass ? "PASS" : "FAIL"}`);
  rows.push("");
  rows.push("INV1 = Email integrity (no placeholders, role emails, malformed)");
  rows.push("INV2 = Scoring coverage (every PersonWorkspace row has icpScore)");
  rows.push("INV3 = Staging path (every Person has a DiscoveredPerson archive row)");
  rows.push("INV4 = Name integrity (real first/last name, no junk literals)");
  rows.push("INV5 = Job title integrity (no salutations, plurals, or empty strings)");
  rows.push("INV6 = Company domain integrity (bare domain, no URLs or paths)");
  rows.push("INV7 = Contactability (every lead has email OR linkedinUrl)");
  if (EXCLUDED_WORKSPACES.size > 0) {
    rows.push("");
    rows.push(
      `Excluded from total: ${Array.from(EXCLUDED_WORKSPACES).join(", ")} (marked [x]) — violations shown but not counted`,
    );
  }
  return rows.join("\n");
}
