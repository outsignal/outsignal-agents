/**
 * exclusion-upload.ts
 *
 * Bulk-upload company exclusions from a CSV file to a workspace's exclusion list.
 * Normalises domains, deduplicates, and upserts via Prisma.
 *
 * Usage:
 *   npx tsx scripts/cli/exclusion-upload.ts --slug <workspace> --file <csv-path> [--reason <default-reason>] [--dry-run]
 *
 * CSV format: "Company Name,Domain" (header row expected). Semicolon delimiter
 * also supported. Extra columns are ignored.
 *
 * Exit codes: 0 on success, 1 on error.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import fs from "node:fs";
import { prisma } from "@/lib/db";
import { normalizeDomain, invalidateCache } from "@/lib/exclusions";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  slug: string;
  file: string;
  reason: string | null;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  let slug = "";
  let file = "";
  let reason: string | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--slug":
        slug = args[++i] ?? "";
        break;
      case "--file":
        file = args[++i] ?? "";
        break;
      case "--reason":
        reason = args[++i] ?? null;
        break;
      case "--dry-run":
        dryRun = true;
        break;
    }
  }

  if (!slug || !file) {
    console.error(
      "Usage: npx tsx scripts/cli/exclusion-upload.ts --slug <workspace> --file <csv-path> [--reason <text>] [--dry-run]",
    );
    process.exit(1);
  }

  return { slug, file, reason, dryRun };
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

interface CsvRow {
  companyName: string | null;
  domain: string | null;
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Detect delimiter from header row
  const header = lines[0];
  const delimiter = header.includes(";") ? ";" : ",";

  // Skip header row
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
    // Expect at least: Company Name, Domain
    const companyName = cols[0] || null;
    const domain = cols[1] || null;
    rows.push({ companyName, domain });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { slug, file, reason, dryRun } = parseArgs();

  // Validate workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { slug: true },
  });
  if (!workspace) {
    console.error(`Workspace "${slug}" not found.`);
    process.exit(1);
  }

  // Read and parse CSV
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  const content = fs.readFileSync(file, "utf-8");
  const rows = parseCsv(content);
  console.log(`Parsed ${rows.length} rows from CSV.`);

  // Process rows
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;

  const seenDomains = new Set<string>();

  for (const row of rows) {
    if (!row.domain) {
      invalid++;
      continue;
    }

    const normalized = normalizeDomain(row.domain);
    if (!normalized) {
      invalid++;
      console.warn(`  INVALID domain: "${row.domain}" (no valid domain found)`);
      continue;
    }

    // Skip duplicate domains within the same file
    if (seenDomains.has(normalized)) {
      skipped++;
      continue;
    }
    seenDomains.add(normalized);

    if (dryRun) {
      console.log(`  [DRY RUN] Would upsert: ${normalized} (${row.companyName ?? "no company name"})`);
      created++; // Count as "would create" for summary
      continue;
    }

    // Upsert: create if not exists, update companyName/reason if exists
    const existing = await prisma.exclusionEntry.findUnique({
      where: {
        workspaceSlug_domain: {
          workspaceSlug: slug,
          domain: normalized,
        },
      },
    });

    if (existing) {
      // Update if we have new data
      const updateData: Record<string, string> = {};
      if (row.companyName && row.companyName !== existing.companyName) {
        updateData.companyName = row.companyName;
      }
      if (reason && reason !== existing.reason) {
        updateData.reason = reason;
      }
      if (Object.keys(updateData).length > 0) {
        await prisma.exclusionEntry.update({
          where: { id: existing.id },
          data: updateData,
        });
        updated++;
      } else {
        skipped++;
      }
    } else {
      await prisma.exclusionEntry.create({
        data: {
          workspaceSlug: slug,
          domain: normalized,
          companyName: row.companyName ?? null,
          reason: reason ?? null,
        },
      });
      created++;
    }
  }

  // Invalidate cache so pipeline enforcement picks up new entries
  invalidateCache(slug);

  // Report
  console.log("\n--- Exclusion Upload Report ---");
  console.log(`  Workspace: ${slug}`);
  console.log(`  File:      ${file}`);
  if (dryRun) console.log("  Mode:      DRY RUN (no writes)");
  console.log(`  Created:   ${created}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Invalid:   ${invalid}`);
  console.log(`  Total:     ${rows.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
