/**
 * One-off script: Pull leads from 4 EmailBison campaigns for Lime Recruitment,
 * upsert into Person table, and create LinkedIn target lists.
 *
 * All 4 campaigns are UK-targeted job role campaigns, so all leads are included.
 *
 * Usage: npx tsx scripts/lime-linkedin-target-lists.ts
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "../src/lib/emailbison/client";
import type { Lead } from "../src/lib/emailbison/types";

const prisma = new PrismaClient();

const WORKSPACE_SLUG = "lime-recruitment";

const CAMPAIGNS = [
  { id: 42, role: "Warehouse Manager" },
  { id: 43, role: "Logistics Manager" },
  { id: 44, role: "Factory Manager" },
  { id: 45, role: "Shift Manager" },
];

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk", "aol.com",
  "icloud.com", "me.com", "mac.com", "mail.com", "mail.ru", "msn.com",
  "protonmail.com", "proton.me", "ymail.com", "zoho.com", "gmx.com",
  "fastmail.com", "hey.com", "tutanota.com", "pm.me",
]);

function deriveCompanyDomain(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

async function getAllCampaignLeads(client: EmailBisonClient, campaignId: number): Promise<Lead[]> {
  const allLeads: Lead[] = [];
  let page = 1;

  const first = await client.getCampaignLeads(campaignId, page, 100);
  allLeads.push(...first.data);
  const lastPage = first.meta.last_page;
  console.log(`  Campaign ${campaignId}: ${first.meta.total} total leads, ${lastPage} pages`);

  while (page < lastPage) {
    page++;
    const res = await client.getCampaignLeads(campaignId, page, 100);
    allLeads.push(...res.data);
  }

  return allLeads;
}

async function main() {
  // Step 1: Get workspace from DB
  const workspace = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
  });

  if (!workspace) {
    console.error(`Workspace "${WORKSPACE_SLUG}" not found!`);
    process.exit(1);
  }

  if (!workspace.apiToken) {
    console.error(`Workspace "${WORKSPACE_SLUG}" has no apiToken!`);
    process.exit(1);
  }

  console.log(`Workspace: ${workspace.name} (${workspace.slug})`);
  console.log("");

  const client = new EmailBisonClient(workspace.apiToken);

  const results: { campaign: string; totalLeads: number; listId: string; listName: string }[] = [];

  for (const campaign of CAMPAIGNS) {
    console.log(`\n--- Campaign ${campaign.id}: ${campaign.role} ---`);

    // Fetch all leads from EmailBison
    const leads = await getAllCampaignLeads(client, campaign.id);
    console.log(`  Fetched ${leads.length} leads`);

    if (leads.length === 0) {
      console.log(`  No leads found. Skipping.`);
      results.push({
        campaign: campaign.role,
        totalLeads: 0,
        listId: "SKIPPED",
        listName: "N/A",
      });
      continue;
    }

    // Upsert Person records in batches
    const personIds: string[] = [];
    let upsertCount = 0;

    for (const lead of leads) {
      const email = lead.email.toLowerCase().trim();
      if (!email) continue;
      const companyDomain = deriveCompanyDomain(email);

      const person = await prisma.person.upsert({
        where: { email },
        create: {
          email,
          firstName: lead.first_name || null,
          lastName: lead.last_name || null,
          company: lead.company || null,
          companyDomain,
          jobTitle: lead.title || null,
          source: "emailbison",
          status: "new",
        },
        update: {},
      });

      personIds.push(person.id);

      // PersonWorkspace link
      await prisma.personWorkspace.upsert({
        where: {
          personId_workspace: {
            personId: person.id,
            workspace: WORKSPACE_SLUG,
          },
        },
        create: {
          personId: person.id,
          workspace: WORKSPACE_SLUG,
          sourceId: String(lead.id),
          status: "new",
        },
        update: {},
      });

      upsertCount++;
      if (upsertCount % 50 === 0) {
        console.log(`  Upserted ${upsertCount}/${leads.length}...`);
      }
    }

    console.log(`  Upserted ${upsertCount} Person records`);

    // Create TargetList
    const listName = `Lime ${campaign.role} - LinkedIn`;
    const targetList = await prisma.targetList.create({
      data: {
        name: listName,
        workspaceSlug: WORKSPACE_SLUG,
        description: `UK leads from EmailBison campaign ${campaign.id} (${campaign.role}) for LinkedIn outreach`,
      },
    });

    console.log(`  Created TargetList: "${listName}" (ID: ${targetList.id})`);

    // Link people to target list using createMany for speed
    const linkData = personIds.map(personId => ({
      listId: targetList.id,
      personId,
    }));

    // createMany with skipDuplicates
    const created = await prisma.targetListPerson.createMany({
      data: linkData,
      skipDuplicates: true,
    });

    console.log(`  Linked ${created.count} people to target list`);

    results.push({
      campaign: campaign.role,
      totalLeads: leads.length,
      listId: targetList.id,
      listName,
    });
  }

  // Final report
  console.log("\n\n========== RESULTS ==========");
  console.log("Campaign                | Total | Target List ID                    | List Name");
  console.log("------------------------|-------|-----------------------------------|----------------------------------");
  for (const r of results) {
    console.log(
      `${r.campaign.padEnd(24)}| ${String(r.totalLeads).padEnd(6)}| ${r.listId.padEnd(36)}| ${r.listName}`
    );
  }
  console.log("=============================");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
