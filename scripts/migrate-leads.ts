/**
 * Migration script: Make leads workspace-agnostic.
 *
 * Run AFTER LeadWorkspace table exists (prisma db push with intermediate schema).
 * Run BEFORE removing workspace/sourceId/vertical/tags from Lead model.
 *
 * Usage:
 *   export DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d'"' -f2)
 *   npx tsx scripts/migrate-leads.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Starting lead migration to workspace-agnostic schema...\n");

  const allLeads = await prisma.lead.findMany({
    orderBy: { updatedAt: "desc" },
  });

  console.log(`Total leads in database: ${allLeads.length}`);

  // Group by lowercase email
  const emailGroups = new Map<string, typeof allLeads>();
  for (const lead of allLeads) {
    const email = lead.email.toLowerCase().trim();
    if (!emailGroups.has(email)) {
      emailGroups.set(email, []);
    }
    emailGroups.get(email)!.push(lead);
  }

  console.log(`Unique emails: ${emailGroups.size}`);

  let duplicateGroups = 0;
  let leadsDeleted = 0;
  let workspaceLinksCreated = 0;
  let leadsMerged = 0;

  for (const [email, leads] of emailGroups) {
    // Score each lead by how many enrichment fields are filled
    const scored = leads.map((lead) => {
      const fields = [
        lead.firstName,
        lead.lastName,
        lead.company,
        lead.companyDomain,
        lead.jobTitle,
        lead.phone,
        lead.linkedinUrl,
        lead.location,
        lead.enrichmentData,
      ];
      return { lead, score: fields.filter((f) => f != null && f !== "").length };
    });
    scored.sort((a, b) => b.score - a.score);

    const master = scored[0].lead;

    if (leads.length > 1) {
      duplicateGroups++;

      // Merge data from duplicates into master
      const updateData: Record<string, string> = {};
      for (const { lead } of scored.slice(1)) {
        if (!master.firstName && lead.firstName)
          updateData.firstName = lead.firstName;
        if (!master.lastName && lead.lastName)
          updateData.lastName = lead.lastName;
        if (!master.company && lead.company)
          updateData.company = lead.company;
        if (!master.companyDomain && lead.companyDomain)
          updateData.companyDomain = lead.companyDomain;
        if (!master.jobTitle && lead.jobTitle)
          updateData.jobTitle = lead.jobTitle;
        if (!master.phone && lead.phone) updateData.phone = lead.phone;
        if (!master.linkedinUrl && lead.linkedinUrl)
          updateData.linkedinUrl = lead.linkedinUrl;
        if (!master.location && lead.location)
          updateData.location = lead.location;

        // Merge enrichmentData JSON
        if (lead.enrichmentData) {
          if (!master.enrichmentData && !updateData.enrichmentData) {
            updateData.enrichmentData = lead.enrichmentData;
          } else {
            try {
              const masterData = JSON.parse(
                updateData.enrichmentData ?? master.enrichmentData ?? "{}",
              );
              const leadData = JSON.parse(lead.enrichmentData);
              updateData.enrichmentData = JSON.stringify({
                ...leadData,
                ...masterData,
              });
            } catch {
              // skip merge on parse error
            }
          }
        }
      }

      // Pick the best status (priority: interested > replied > contacted > bounced > new > unsubscribed)
      const statusPriority: Record<string, number> = {
        interested: 6,
        replied: 5,
        contacted: 4,
        bounced: 3,
        new: 2,
        unsubscribed: 1,
      };
      const bestStatus = leads.reduce((best, lead) => {
        return (statusPriority[lead.status] ?? 0) >
          (statusPriority[best] ?? 0)
          ? lead.status
          : best;
      }, master.status);
      if (bestStatus !== master.status) {
        (updateData as Record<string, string>).status = bestStatus;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.lead.update({
          where: { id: master.id },
          data: updateData,
        });
        leadsMerged++;
      }

      // Delete duplicates BEFORE creating workspace links (to avoid FK issues)
      const duplicateIds = scored.slice(1).map((s) => s.lead.id);
      await prisma.lead.deleteMany({
        where: { id: { in: duplicateIds } },
      });
      leadsDeleted += duplicateIds.length;
    }

    // Create LeadWorkspace entries for ALL leads in the group (using master.id)
    for (const { lead } of scored) {
      if (lead.workspace) {
        try {
          await prisma.leadWorkspace.create({
            data: {
              leadId: master.id,
              workspace: lead.workspace,
              sourceId: lead.sourceId,
              status: lead.status,
              vertical: lead.vertical,
              tags: lead.tags,
            },
          });
          workspaceLinksCreated++;
        } catch {
          // Duplicate leadId+workspace — skip (same lead in same workspace twice)
        }
      }
    }
  }

  // Normalize emails to lowercase (in case of case mismatches that weren't grouped)
  await prisma.$executeRaw`
    UPDATE "Lead" SET email = LOWER(TRIM(email))
    WHERE email != LOWER(TRIM(email))
  `;

  // Final stats
  const finalLeadCount = await prisma.lead.count();
  const workspaceLinkCount = await prisma.leadWorkspace.count();

  console.log(`\nMigration complete:`);
  console.log(`  Duplicate groups resolved: ${duplicateGroups}`);
  console.log(`  Leads deleted (merged): ${leadsDeleted}`);
  console.log(`  Leads with data merged: ${leadsMerged}`);
  console.log(`  Workspace links created: ${workspaceLinksCreated}`);
  console.log(`\n  Final lead count: ${finalLeadCount}`);
  console.log(`  Workspace links: ${workspaceLinkCount}`);

  // Verify no duplicate emails remain
  const dupes = await prisma.$queryRaw<{ email: string; cnt: bigint }[]>`
    SELECT email, COUNT(*) as cnt FROM "Lead"
    GROUP BY email HAVING COUNT(*) > 1
  `;
  if (dupes.length > 0) {
    console.error(
      `\n  WARNING: ${dupes.length} emails still have duplicates!`,
    );
    for (const d of dupes.slice(0, 10)) {
      console.error(`    ${d.email} (${d.cnt} records)`);
    }
  } else {
    console.log(`\n  All emails are now unique. Safe to update schema.`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
