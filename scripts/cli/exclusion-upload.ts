/**
 * exclusion-upload.ts
 *
 * Bulk-upload company exclusions (domains or emails) from a CSV file to a
 * workspace's exclusion list. Normalises domains, deduplicates, and upserts
 * via Prisma.
 *
 * Usage:
 *   npx tsx scripts/cli/exclusion-upload.ts --slug <workspace> --file <csv-path> [--type domain|email] [--reason <default-reason>] [--dry-run]
 *
 * Domain mode (default): CSV format "Company Name,Domain" (header row expected).
 * Email mode: CSV format "Email" (one email per line, header row expected).
 * Semicolon delimiter also supported. Extra columns are ignored.
 *
 * Exit codes: 0 on success, 1 on error.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import fs from "node:fs";
import { prisma } from "@/lib/db";
import { normalizeDomain, invalidateCache } from "@/lib/exclusions";
import { EmailBisonClient } from "@/lib/emailbison/client";

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  slug: string;
  file: string;
  type: "domain" | "email";
  reason: string | null;
  dryRun: boolean;
  syncEb: boolean;
} {
  const args = process.argv.slice(2);
  let slug = "";
  let file = "";
  let type: "domain" | "email" = "domain";
  let reason: string | null = null;
  let dryRun = false;
  let syncEb = true;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--slug":
        slug = args[++i] ?? "";
        break;
      case "--file":
        file = args[++i] ?? "";
        break;
      case "--type":
        type = (args[++i] ?? "domain") as "domain" | "email";
        break;
      case "--reason":
        reason = args[++i] ?? null;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--sync-eb":
        syncEb = (args[++i] ?? "true") !== "false";
        break;
      case "--no-sync-eb":
        syncEb = false;
        break;
    }
  }

  if (!slug || !file) {
    console.error(
      "Usage: npx tsx scripts/cli/exclusion-upload.ts --slug <workspace> --file <csv-path> [--type domain|email] [--reason <text>] [--dry-run] [--no-sync-eb]",
    );
    process.exit(1);
  }

  if (type !== "domain" && type !== "email") {
    console.error(`Invalid --type: "${type}". Must be "domain" or "email".`);
    process.exit(1);
  }

  return { slug, file, type, reason, dryRun, syncEb };
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
// Email CSV parsing
// ---------------------------------------------------------------------------

function parseEmailCsv(content: string): string[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  // Detect delimiter from header row
  const header = lines[0];
  const delimiter = header.includes(";") ? ";" : ",";

  // Skip header row
  const emails: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
    const email = cols[0]?.toLowerCase().trim();
    if (email && email.includes("@")) {
      emails.push(email);
    }
  }

  return emails;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { slug, file, type, reason, dryRun, syncEb } = parseArgs();

  // Validate workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { slug: true, apiToken: true },
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

  if (type === "email") {
    await processEmailUpload(slug, content, reason, dryRun, syncEb, workspace.apiToken);
  } else {
    await processDomainUpload(slug, content, reason, dryRun, syncEb, workspace.apiToken);
  }
}

// ---------------------------------------------------------------------------
// Email upload
// ---------------------------------------------------------------------------

async function processEmailUpload(
  slug: string,
  content: string,
  reason: string | null,
  dryRun: boolean,
  syncEb: boolean,
  apiToken: string | null,
): Promise<void> {
  const emails = parseEmailCsv(content);
  console.log(`Parsed ${emails.length} emails from CSV.`);

  let created = 0;
  let skipped = 0;
  let invalid = 0;

  const seenEmails = new Set<string>();

  for (const email of emails) {
    if (!email.includes("@") || !email.includes(".")) {
      invalid++;
      console.warn(`  INVALID email: "${email}"`);
      continue;
    }

    const normalized = email.toLowerCase().trim();

    // Skip duplicates within the same file
    if (seenEmails.has(normalized)) {
      skipped++;
      continue;
    }
    seenEmails.add(normalized);

    if (dryRun) {
      console.log(`  [DRY RUN] Would upsert email: ${normalized}`);
      created++;
      continue;
    }

    await prisma.exclusionEmail.upsert({
      where: {
        workspaceSlug_email: { workspaceSlug: slug, email: normalized },
      },
      update: {
        ...(reason ? { reason } : {}),
      },
      create: {
        workspaceSlug: slug,
        email: normalized,
        reason: reason ?? null,
      },
    });
    created++;
  }

  // Invalidate cache
  invalidateCache(slug);

  // Sync to EmailBison email blacklist
  let ebSynced = 0;
  let ebAlreadyExists = 0;
  let ebFailed = 0;
  let ebSkipped = false;

  if (syncEb && !dryRun && seenEmails.size > 0) {
    if (!apiToken) {
      console.warn("\n[EB Sync] Workspace has no apiToken — skipping EmailBison blacklist sync.");
      ebSkipped = true;
    } else {
      const eb = new EmailBisonClient(apiToken);
      console.log(`\n[EB Sync] Syncing ${seenEmails.size} emails to EmailBison email blacklist...`);

      for (const email of seenEmails) {
        try {
          const existing = await eb.getBlacklistedEmail(email);
          if (existing) {
            ebAlreadyExists++;
            continue;
          }
          await eb.blacklistEmail(email);
          ebSynced++;
        } catch (err) {
          ebFailed++;
          console.warn(`  [EB Sync] FAILED to blacklist email "${email}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      console.log(`[EB Sync] Done: ${ebSynced} synced, ${ebAlreadyExists} already existed, ${ebFailed} failed.`);
    }
  }

  // Report
  console.log("\n--- Email Exclusion Upload Report ---");
  console.log(`  Workspace: ${slug}`);
  console.log(`  Type:      email`);
  if (dryRun) console.log("  Mode:      DRY RUN (no writes)");
  console.log(`  Created:   ${created}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Invalid:   ${invalid}`);
  console.log(`  Total:     ${emails.length}`);

  if (syncEb && !dryRun) {
    console.log("\n--- EmailBison Email Blacklist Sync ---");
    if (ebSkipped) {
      console.log("  Status:    SKIPPED (no apiToken)");
    } else {
      console.log(`  Synced:    ${ebSynced}`);
      console.log(`  Existing:  ${ebAlreadyExists}`);
      console.log(`  Failed:    ${ebFailed}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Domain upload (original logic)
// ---------------------------------------------------------------------------

async function processDomainUpload(
  slug: string,
  content: string,
  reason: string | null,
  dryRun: boolean,
  syncEb: boolean,
  apiToken: string | null,
): Promise<void> {
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

  // Sync to EmailBison blacklist (defence in depth)
  let ebSynced = 0;
  let ebAlreadyExists = 0;
  let ebFailed = 0;
  let ebSkipped = false;

  if (syncEb && !dryRun && seenDomains.size > 0) {
    if (!apiToken) {
      console.warn("\n[EB Sync] Workspace has no apiToken — skipping EmailBison blacklist sync.");
      ebSkipped = true;
    } else {
      const eb = new EmailBisonClient(apiToken);
      console.log(`\n[EB Sync] Syncing ${seenDomains.size} domains to EmailBison blacklist...`);

      for (const domain of seenDomains) {
        try {
          const existing = await eb.getBlacklistedDomain(domain);
          if (existing) {
            ebAlreadyExists++;
            continue;
          }
          await eb.blacklistDomain(domain);
          ebSynced++;
        } catch (err) {
          ebFailed++;
          console.warn(`  [EB Sync] FAILED to blacklist "${domain}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      console.log(`[EB Sync] Done: ${ebSynced} synced, ${ebAlreadyExists} already existed, ${ebFailed} failed.`);
    }
  }

  // Report
  console.log("\n--- Exclusion Upload Report ---");
  console.log(`  Workspace: ${slug}`);
  console.log(`  Type:      domain`);
  console.log(`  File:      (from CSV)`);
  if (dryRun) console.log("  Mode:      DRY RUN (no writes)");
  console.log(`  Created:   ${created}`);
  console.log(`  Updated:   ${updated}`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Invalid:   ${invalid}`);
  console.log(`  Total:     ${rows.length}`);

  if (syncEb && !dryRun) {
    console.log("\n--- EmailBison Blacklist Sync ---");
    if (ebSkipped) {
      console.log("  Status:    SKIPPED (no apiToken)");
    } else {
      console.log(`  Synced:    ${ebSynced}`);
      console.log(`  Existing:  ${ebAlreadyExists}`);
      console.log(`  Failed:    ${ebFailed}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
