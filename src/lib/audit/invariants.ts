/**
 * System invariants audit — shared library.
 *
 * Produces a per-workspace pass/fail report for the three data integrity
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
}

export interface InvariantAuditResult {
  generatedAt: string;
  perWorkspace: WorkspaceInvariantResult[];
  totals: {
    totalLeads: number;
    inv1Violations: number;
    inv2Violations: number;
    inv3Violations: number;
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

  // Totals per workspace for context.
  const totalsPromise = prisma.$queryRawUnsafe<
    Array<{ workspace: string; total: number }>
  >(`
    SELECT workspace, COUNT(*)::int AS total
    FROM "LeadWorkspace"
    GROUP BY workspace
  `);

  const [inv1Rows, inv2Rows, inv3Rows, totalsRows] = await Promise.all([
    inv1Promise,
    inv2Promise,
    inv3Promise,
    totalsPromise,
  ]);

  const inv1Map = new Map(inv1Rows.map((r) => [r.workspace, r.violations]));
  const inv2Map = new Map(inv2Rows.map((r) => [r.workspace, r.violations]));
  const inv3Map = new Map(inv3Rows.map((r) => [r.workspace, r.violations]));

  const perWorkspace: WorkspaceInvariantResult[] = totalsRows
    .sort((a, b) => b.total - a.total)
    .map((r) => {
      const inv1 = inv1Map.get(r.workspace) ?? 0;
      const inv2 = inv2Map.get(r.workspace) ?? 0;
      const inv3 = inv3Map.get(r.workspace) ?? 0;
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
      }),
      { totalLeads: 0, inv1Violations: 0, inv2Violations: 0, inv3Violations: 0 },
    );

  const allPass =
    totals.inv1Violations === 0 &&
    totals.inv2Violations === 0 &&
    totals.inv3Violations === 0;

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
 */
export function renderAuditTable(audit: InvariantAuditResult): string {
  const rows: string[] = [];
  rows.push(
    "workspace".padEnd(26) +
      "total".padStart(8) +
      "INV1".padStart(8) +
      "INV2".padStart(10) +
      "INV3".padStart(10),
  );
  rows.push("-".repeat(62));
  for (const r of audit.perWorkspace) {
    const prefix = r.excluded ? "[excl] " : "       ";
    const i1 = r.inv1Pass ? "✓".padStart(8) : (`✗ ${r.inv1Violations}`).padStart(8);
    const i2 = r.inv2Pass ? "✓".padStart(10) : (`✗ ${r.inv2Violations}`).padStart(10);
    const i3 = r.inv3Pass ? "✓".padStart(10) : (`✗ ${r.inv3Violations}`).padStart(10);
    rows.push(
      prefix + r.workspace.padEnd(19) + String(r.totalLeads).padStart(8) + i1 + i2 + i3,
    );
  }
  rows.push("-".repeat(62));
  const iT1 = audit.totals.inv1Violations === 0 ? "✓".padStart(8) : (`✗ ${audit.totals.inv1Violations}`).padStart(8);
  const iT2 = audit.totals.inv2Violations === 0 ? "✓".padStart(10) : (`✗ ${audit.totals.inv2Violations}`).padStart(10);
  const iT3 = audit.totals.inv3Violations === 0 ? "✓".padStart(10) : (`✗ ${audit.totals.inv3Violations}`).padStart(10);
  rows.push(
    "TOTAL (active)".padEnd(26) + String(audit.totals.totalLeads).padStart(8) + iT1 + iT2 + iT3,
  );
  rows.push("");
  rows.push(`OVERALL: ${audit.allPass ? "PASS" : "FAIL"}`);
  rows.push("");
  rows.push("INV1 = Email integrity (no placeholders, no role emails, no malformed)");
  rows.push("INV2 = Scoring coverage (every PersonWorkspace row has icpScore)");
  rows.push("INV3 = Staging path (every Person has a DiscoveredPerson archive row)");
  if (EXCLUDED_WORKSPACES.size > 0) {
    rows.push("");
    rows.push(
      `Excluded from total: ${Array.from(EXCLUDED_WORKSPACES).join(", ")} (marked [excl]) — violations shown but not counted`,
    );
  }
  return rows.join("\n");
}
