/**
 * sync-emailbison-leads.ts
 *
 * CLI script: sync leads from EmailBison into the local Person table.
 * Usage: npx tsx scripts/cli/sync-emailbison-leads.ts <workspaceSlug>
 *
 * Fetches all campaigns for the workspace, paginates through all leads,
 * deduplicates by email, upserts into Person, and links via PersonWorkspace.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { normalizeCompanyName } from "@/lib/normalize";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk", "aol.com",
  "icloud.com", "me.com", "mac.com", "mail.com", "mail.ru", "msn.com",
  "protonmail.com", "proton.me", "ymail.com", "zoho.com", "gmx.com",
  "fastmail.com", "hey.com", "tutanota.com", "pm.me",
]);

function deriveCompanyDomain(email: string): string | null {
  const domain = email.toLowerCase().trim().split("@")[1];
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

interface EBLead {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  company?: string;
  phone?: string;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: npx tsx scripts/cli/sync-emailbison-leads.ts <workspaceSlug>");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    console.log(`Syncing leads for workspace: ${slug}`);

    // Look up workspace
    const workspace = await prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) {
      console.error(`Workspace "${slug}" not found.`);
      process.exit(1);
    }
    if (!workspace.apiToken) {
      console.error(`Workspace "${slug}" has no apiToken configured.`);
      process.exit(1);
    }

    const client = new EmailBisonClient(workspace.apiToken);

    // Fetch all workspace leads (regardless of campaign attachment)
    console.log("Fetching all workspace leads...");
    const allLeads = await client.getLeads();
    console.log(`Fetched ${allLeads.length} leads from EmailBison.`);

    // Deduplicate by email
    const uniqueLeads = new Map<string, EBLead>();
    for (const lead of allLeads) {
      if (!lead.email) continue;
      const email = lead.email.toLowerCase().trim();
      if (!uniqueLeads.has(email)) {
        uniqueLeads.set(email, lead);
      }
    }

    console.log(`${uniqueLeads.size} unique by email.\n`);

    const stats = { created: 0, updated: 0, skipped: 0, linked: 0 };

    for (const [email, lead] of uniqueLeads) {
      const companyDomain = deriveCompanyDomain(email);
      const companyName = lead.company ? normalizeCompanyName(lead.company) : null;

      // Upsert Person
      const existing = await prisma.person.findUnique({ where: { email } });
      let personId: string;

      if (!existing) {
        const person = await prisma.person.create({
          data: {
            email,
            firstName: lead.first_name ?? null,
            lastName: lead.last_name ?? null,
            company: companyName ?? null,
            companyDomain,
            jobTitle: lead.title ?? null,
            phone: lead.phone ?? null,
            source: "emailbison",
          },
        });
        personId = person.id;
        stats.created++;
      } else {
        personId = existing.id;
        // Only fill empty fields, never overwrite
        const updateData: Record<string, unknown> = {};
        if (lead.first_name && !existing.firstName) updateData.firstName = lead.first_name;
        if (lead.last_name && !existing.lastName) updateData.lastName = lead.last_name;
        if (companyName && !existing.company) updateData.company = companyName;
        if (companyDomain && !existing.companyDomain) updateData.companyDomain = companyDomain;
        if (lead.title && !existing.jobTitle) updateData.jobTitle = lead.title;
        if (lead.phone && !existing.phone) updateData.phone = lead.phone;

        if (Object.keys(updateData).length > 0) {
          await prisma.person.update({ where: { id: existing.id }, data: updateData });
          stats.updated++;
        } else {
          stats.skipped++;
        }
      }

      // Upsert PersonWorkspace junction
      const existingLink = await prisma.personWorkspace.findUnique({
        where: {
          personId_workspace: { personId, workspace: slug },
        },
      });

      if (!existingLink) {
        await prisma.personWorkspace.create({
          data: { personId, workspace: slug },
        });
        stats.linked++;
      }
    }

    console.log(`\nSync complete:`);
    console.log(`  Fetched: ${allLeads.length} (${uniqueLeads.size} unique)`);
    console.log(`  Created: ${stats.created}`);
    console.log(`  Updated: ${stats.updated}`);
    console.log(`  Skipped (no changes): ${stats.skipped}`);
    console.log(`  Workspace links created: ${stats.linked}`);
  } catch (error) {
    console.error("Sync failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
