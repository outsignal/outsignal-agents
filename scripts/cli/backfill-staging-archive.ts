/**
 * backfill-staging-archive.ts
 *
 * Creates synthetic DiscoveredPerson archive rows for every Person that
 * bypassed the discovery → staging → promotion path. This fixes INV3
 * (staging path invariant) for historical data.
 *
 * Context:
 * ~12,600 Person rows exist without a linked DiscoveredPerson. They came
 * from the EmailBison sync endpoint, Clay imports (now retired), manual
 * uploads, or early discovery runs predating the current staging behaviour.
 * Without a DiscoveredPerson archive row, future discovery runs can't
 * dedup against these historical leads and will re-buy them.
 *
 * Strategy:
 * For each Person without a DiscoveredPerson row, create a synthetic one:
 *   - personId: links back to the Person (one-to-one)
 *   - workspaceSlug: matches the PersonWorkspace.workspace
 *   - status: "promoted" (so dedup filters recognise it)
 *   - promotedAt: Person.createdAt (historical — keeps it OUT of current
 *     billing window quota counts)
 *   - discoverySource: Person.source (preserves provenance)
 *   - firstName, lastName, jobTitle, company, companyDomain, linkedinUrl,
 *     phone, location, email: copied from Person
 *   - rawResponse: JSON blob including _backfilledAt, _backfillReason,
 *     _originalSource so we can always identify synthetic rows
 *
 * Safety:
 *   - --dry-run (default) counts candidates and shows per-workspace summary
 *   - --apply flag required to actually insert rows
 *   - --workspace flag to scope to one workspace at a time
 *   - Idempotent: skips any Person that already has a linked DiscoveredPerson
 *   - Uses createMany with skipDuplicates so re-running is safe
 *   - Does NOT touch outsignal (excluded from invariant checks)
 *
 * Usage:
 *   # Dry-run, all active workspaces
 *   npx tsx scripts/cli/backfill-staging-archive.ts
 *
 *   # Apply for one workspace (safer — verify first)
 *   npx tsx scripts/cli/backfill-staging-archive.ts --workspace 1210-solutions --apply
 *
 *   # Apply across all active workspaces
 *   npx tsx scripts/cli/backfill-staging-archive.ts --apply
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXCLUDED_WORKSPACES = new Set<string>(["outsignal"]);

interface Args {
  apply: boolean;
  workspace: string | null;
  batchSize: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    apply: false,
    workspace: null,
    batchSize: 500,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--workspace") args.workspace = argv[++i];
    else if (a === "--batch-size") args.batchSize = parseInt(argv[++i], 10);
  }
  return args;
}

interface Candidate {
  personId: string;
  workspace: string;
  // Person fields copied into the synthetic DiscoveredPerson row
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  location: string | null;
  source: string | null;
  personCreatedAt: Date;
}

async function loadCandidates(workspaceFilter: string | null): Promise<Candidate[]> {
  // Build the workspace filter — always exclude outsignal, optionally scope
  // to a single workspace.
  const excludeList = Array.from(EXCLUDED_WORKSPACES).map((w) => `'${w.replace(/'/g, "''")}'`).join(",");
  const workspaceClause = workspaceFilter
    ? `AND lw.workspace = '${workspaceFilter.replace(/'/g, "''")}'`
    : "";

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      personid: string;
      workspace: string;
      email: string | null;
      firstname: string | null;
      lastname: string | null;
      jobtitle: string | null;
      company: string | null;
      companydomain: string | null;
      linkedinurl: string | null;
      phone: string | null;
      location: string | null;
      source: string | null;
      personcreatedat: Date;
    }>
  >(
    `
    SELECT
      l.id AS personid,
      lw.workspace AS workspace,
      l.email,
      l."firstName" AS firstname,
      l."lastName" AS lastname,
      l."jobTitle" AS jobtitle,
      l.company,
      l."companyDomain" AS companydomain,
      l."linkedinUrl" AS linkedinurl,
      l.phone,
      l.location,
      l.source,
      l."createdAt" AS personcreatedat
    FROM "LeadWorkspace" lw
    INNER JOIN "Lead" l ON lw."leadId" = l.id
    LEFT JOIN "DiscoveredPerson" dp ON dp."personId" = l.id AND dp."workspaceSlug" = lw.workspace
    WHERE dp.id IS NULL
      AND lw.workspace NOT IN (${excludeList})
      ${workspaceClause}
    ORDER BY lw.workspace, l."createdAt"
    `,
  );

  return rows.map((r) => ({
    personId: r.personid,
    workspace: r.workspace,
    email: r.email,
    firstName: r.firstname,
    lastName: r.lastname,
    jobTitle: r.jobtitle,
    company: r.company,
    companyDomain: r.companydomain,
    linkedinUrl: r.linkedinurl,
    phone: r.phone,
    location: r.location,
    source: r.source,
    personCreatedAt: r.personcreatedat,
  }));
}

function buildRawResponse(c: Candidate): string {
  return JSON.stringify({
    _backfilledAt: new Date().toISOString(),
    _backfillReason: "INV3 — Person bypassed discovery staging. Synthetic DiscoveredPerson row created so dedup can see historical leads.",
    _originalSource: c.source,
    _personId: c.personId,
  });
}

async function main(): Promise<unknown> {
  const args = parseArgs();

  process.stderr.write(`\n[backfill-staging] Scanning for Person rows without DiscoveredPerson archive...\n`);
  if (args.workspace) {
    process.stderr.write(`[backfill-staging] Scoped to workspace: ${args.workspace}\n`);
  }

  const candidates = await loadCandidates(args.workspace);
  process.stderr.write(`[backfill-staging] Found ${candidates.length} candidates\n\n`);

  // Per-workspace + per-source breakdown
  const byWs: Map<string, Map<string, number>> = new Map();
  for (const c of candidates) {
    const wsMap = byWs.get(c.workspace) ?? new Map<string, number>();
    const key = c.source ?? "null";
    wsMap.set(key, (wsMap.get(key) ?? 0) + 1);
    byWs.set(c.workspace, wsMap);
  }

  process.stderr.write("Per-workspace breakdown:\n");
  for (const [ws, srcMap] of byWs) {
    const total = Array.from(srcMap.values()).reduce((a, b) => a + b, 0);
    process.stderr.write(`  ${ws.padEnd(22)} ${String(total).padStart(6)}\n`);
    for (const [src, c] of srcMap) {
      process.stderr.write(`    ${src.padEnd(28)} ${String(c).padStart(6)}\n`);
    }
  }
  process.stderr.write(`\nTotal: ${candidates.length}\n`);

  if (!args.apply) {
    process.stderr.write(`\n[DRY RUN] Nothing was written. Pass --apply to execute.\n`);
    return {
      dryRun: true,
      total: candidates.length,
      byWorkspace: Array.from(byWs.entries()).map(([ws, srcMap]) => ({
        workspace: ws,
        bySource: Array.from(srcMap.entries()).map(([source, count]) => ({ source, count })),
        total: Array.from(srcMap.values()).reduce((a, b) => a + b, 0),
      })),
    };
  }

  // --- APPLY MODE ---
  process.stderr.write(`\n[APPLY] Writing synthetic DiscoveredPerson rows in batches of ${args.batchSize}...\n`);

  let written = 0;
  let skipped = 0;
  const failures: Array<{ personId: string; workspace: string; error: string }> = [];
  const startedAt = Date.now();

  for (let i = 0; i < candidates.length; i += args.batchSize) {
    const batch = candidates.slice(i, i + args.batchSize);

    // Build createMany data — createMany with skipDuplicates handles the
    // "already exists" case gracefully via the unique index on personId.
    const data = batch.map((c) => ({
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      jobTitle: c.jobTitle,
      company: c.company,
      companyDomain: c.companyDomain,
      linkedinUrl: c.linkedinUrl,
      phone: c.phone,
      location: c.location,
      discoverySource: c.source ?? "backfilled",
      workspaceSlug: c.workspace,
      status: "promoted",
      personId: c.personId,
      promotedAt: c.personCreatedAt, // historical date — keeps it out of quota window
      rawResponse: buildRawResponse(c),
    }));

    try {
      const result = await prisma.discoveredPerson.createMany({
        data,
        skipDuplicates: true,
      });
      written += result.count;
      skipped += batch.length - result.count;

      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = written > 0 ? (written / elapsed).toFixed(0) : "0";
      const remaining = candidates.length - (i + batch.length);
      const etaSec = written > 0 && remaining > 0 ? Math.round((remaining / written) * elapsed) : 0;
      process.stderr.write(
        `[backfill-staging] written=${written} skipped=${skipped} remaining=${remaining} rate=${rate}/s eta=${etaSec}s\n`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[backfill-staging] BATCH FAILED (${i}-${i + batch.length}): ${message}\n`);
      // Record per-person so we know what failed
      for (const c of batch) {
        failures.push({ personId: c.personId, workspace: c.workspace, error: message });
      }
    }
  }

  const wallTimeSec = Math.round((Date.now() - startedAt) / 1000);
  process.stderr.write(`\n=== Final report ===\n`);
  process.stderr.write(`Total candidates: ${candidates.length}\n`);
  process.stderr.write(`Written: ${written}\n`);
  process.stderr.write(`Skipped (already exist): ${skipped}\n`);
  process.stderr.write(`Failed: ${failures.length}\n`);
  process.stderr.write(`Wall time: ${wallTimeSec}s\n`);

  if (failures.length > 0) {
    process.stderr.write(`\nFirst 5 failures:\n`);
    for (const f of failures.slice(0, 5)) {
      process.stderr.write(`  ${f.workspace}/${f.personId}: ${f.error}\n`);
    }
  }

  await prisma.$disconnect();

  return {
    apply: true,
    total: candidates.length,
    written,
    skipped,
    failed: failures.length,
    wallTimeSeconds: wallTimeSec,
    failureSamples: failures.slice(0, 10),
  };
}

runWithHarness("backfill-staging-archive [--apply] [--workspace SLUG] [--batch-size N]", main);
