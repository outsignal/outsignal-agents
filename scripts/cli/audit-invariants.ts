/**
 * audit-invariants.ts
 *
 * System-wide audit of the four Outsignal data invariants:
 *
 *   INV1 — Email integrity: every Person.email is NULL or verified-valid.
 *          No placeholders, no role emails, no malformed strings.
 *
 *   INV2 — Scoring coverage: every PersonWorkspace has icpScore NOT NULL.
 *
 *   INV3 — Staging path: every Person has a corresponding DiscoveredPerson
 *          archive row (linked via DiscoveredPerson.personId).
 *
 *   INV4 — Rubric uniformity: every workspace uses the shared scoring rubric
 *          structure (5 criteria, 0-20 anchors, stable output schema).
 *          Placeholder for now — requires structural analysis.
 *
 * Usage:
 *   npx tsx scripts/cli/audit-invariants.ts
 *
 * Output: pass/fail table per workspace + system totals.
 * Exit code: 0 if all invariants hold, 1 if any fail.
 *
 * READ-ONLY. No writes. Safe to run against prod DB.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Workspaces deliberately excluded from invariant totals.
 * These workspaces have a known structural reason for violating one or more
 * invariants, and fixing them requires design work, not a patch.
 *
 * Excluded workspaces are still shown in the per-workspace table (so drift
 * is visible), but their violations DO NOT count towards the system total
 * or the overall PASS/FAIL verdict.
 *
 * 2026-04-11 — outsignal: Per-campaign ICP model. Outsignal runs per-client
 * campaigns with different sub-ICPs per target list. A single workspace
 * icpCriteriaPrompt cannot capture this. Architectural work needed to move
 * scoring from workspace-scoped to campaign- or list-scoped. Parked until
 * the per-campaign scoring model is designed.
 */
const EXCLUDED_WORKSPACES = new Set<string>(["outsignal"]);

interface WorkspaceInvariantResult {
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

interface SystemAudit {
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

async function main(): Promise<SystemAudit> {
  // Pull per-workspace violation counts in a single query each.

  // INV1: placeholders, role emails, and malformed email strings.
  // "Valid" means: email is null, OR email matches a basic shape and does
  // not start with info@/sales@/contact@/hello@/admin@, and is not
  // @discovery.internal / @discovered.local.
  const inv1Rows = await prisma.$queryRawUnsafe<
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
  const inv2Rows = await prisma.$queryRawUnsafe<
    Array<{ workspace: string; violations: number }>
  >(`
    SELECT workspace, COUNT(*)::int AS violations
    FROM "LeadWorkspace"
    WHERE "icpScore" IS NULL
    GROUP BY workspace
  `);

  // INV3: Person rows without a linked DiscoveredPerson archive row.
  // Cross-workspace: a Person is "archived" if any DiscoveredPerson.personId
  // matches its id. Bypass paths (EmailBison sync, manual) create Person
  // rows without writing DiscoveredPerson at all.
  const inv3Rows = await prisma.$queryRawUnsafe<
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
  const totalsRows = await prisma.$queryRawUnsafe<
    Array<{ workspace: string; total: number }>
  >(`
    SELECT workspace, COUNT(*)::int AS total
    FROM "LeadWorkspace"
    GROUP BY workspace
  `);

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

  // Totals exclude workspaces in EXCLUDED_WORKSPACES so the overall PASS/FAIL
  // verdict reflects the state of workspaces we actively manage.
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

  // Pretty-print a human-readable table to stderr so the JSON envelope to
  // stdout stays clean for scripting/CI.
  const rows: string[] = [];
  rows.push(
    "workspace".padEnd(26) +
      "total".padStart(8) +
      "INV1".padStart(8) +
      "INV2".padStart(10) +
      "INV3".padStart(10),
  );
  rows.push("-".repeat(62));
  for (const r of perWorkspace) {
    const prefix = r.excluded ? "[excl] " : "       ";
    const i1 = r.inv1Pass ? "✓".padStart(8) : (`✗ ${r.inv1Violations}`).padStart(8);
    const i2 = r.inv2Pass ? "✓".padStart(10) : (`✗ ${r.inv2Violations}`).padStart(10);
    const i3 = r.inv3Pass ? "✓".padStart(10) : (`✗ ${r.inv3Violations}`).padStart(10);
    rows.push(
      prefix + r.workspace.padEnd(19) + String(r.totalLeads).padStart(8) + i1 + i2 + i3,
    );
  }
  rows.push("-".repeat(62));
  const iT1 = totals.inv1Violations === 0 ? "✓".padStart(8) : (`✗ ${totals.inv1Violations}`).padStart(8);
  const iT2 = totals.inv2Violations === 0 ? "✓".padStart(10) : (`✗ ${totals.inv2Violations}`).padStart(10);
  const iT3 = totals.inv3Violations === 0 ? "✓".padStart(10) : (`✗ ${totals.inv3Violations}`).padStart(10);
  rows.push(
    "TOTAL (active)".padEnd(26) + String(totals.totalLeads).padStart(8) + iT1 + iT2 + iT3,
  );
  rows.push("");
  rows.push(`OVERALL: ${allPass ? "PASS" : "FAIL"}`);
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
  process.stderr.write(rows.join("\n") + "\n");

  await prisma.$disconnect();

  return {
    generatedAt: new Date().toISOString(),
    perWorkspace,
    totals,
    allPass,
  };
}

runWithHarness("audit-invariants", main);
