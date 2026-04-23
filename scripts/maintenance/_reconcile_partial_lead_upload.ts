/**
 * Reconcile a partial EmailBison lead upload by retrying only the missing leads.
 *
 * Dry-run by default. Pass --apply to upsert the missing leads into EmailBison
 * and attach them to the campaign.
 *
 * Usage:
 *   npx tsx scripts/maintenance/_reconcile_partial_lead_upload.ts --campaign <campaignId>
 *   npx tsx scripts/maintenance/_reconcile_partial_lead_upload.ts --campaign <campaignId> --apply
 *   npx tsx scripts/maintenance/_reconcile_partial_lead_upload.ts --campaign <campaignId> --workspace <slug>
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "../../src/lib/emailbison/client";
import { buildEmailLeadPayload } from "../../src/lib/emailbison/lead-payload";

const prisma = new PrismaClient();
const LOG_PREFIX = "[reconcile-partial-lead-upload]";
const APPLY = process.argv.includes("--apply");
const CHUNK_SIZE = 500;

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function getAllCampaignLeadEmails(
  client: EmailBisonClient,
  ebCampaignId: number,
): Promise<Set<string>> {
  const emails = new Set<string>();
  let page = 1;

  while (true) {
    const response = await client.getCampaignLeads(ebCampaignId, page, 100);
    for (const lead of response.data) {
      emails.add(normalizeEmail(lead.email));
    }
    if (!response.links.next || page >= response.meta.last_page) {
      break;
    }
    page += 1;
  }

  return emails;
}

async function main() {
  const campaignId = readArg("--campaign");
  const workspaceOverride = readArg("--workspace");

  if (!campaignId) {
    throw new Error("Missing required --campaign <campaignId> argument");
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      name: true,
      workspaceSlug: true,
      description: true,
      targetListId: true,
      emailBisonCampaignId: true,
    },
  });

  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }
  if (!campaign.emailBisonCampaignId) {
    throw new Error(`Campaign ${campaignId} has no emailBisonCampaignId`);
  }
  if (!campaign.targetListId) {
    throw new Error(`Campaign ${campaignId} has no targetListId`);
  }
  if (workspaceOverride && workspaceOverride !== campaign.workspaceSlug) {
    throw new Error(
      `Campaign ${campaignId} belongs to workspace '${campaign.workspaceSlug}', not '${workspaceOverride}'`,
    );
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug: campaign.workspaceSlug },
    select: { apiToken: true },
  });
  if (!workspace?.apiToken) {
    throw new Error(
      `Workspace '${campaign.workspaceSlug}' has no EmailBison API token`,
    );
  }

  const client = new EmailBisonClient(workspace.apiToken);
  const targetListLeads = await prisma.targetListPerson.findMany({
    where: { listId: campaign.targetListId },
    select: {
      person: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          jobTitle: true,
          company: true,
          companyDomain: true,
          location: true,
        },
      },
    },
  });

  const ebCampaignLeadEmails = await getAllCampaignLeadEmails(
    client,
    campaign.emailBisonCampaignId,
  );

  const desiredPayloads = targetListLeads
    .map(({ person }) => person)
    .filter(
      (
        person,
      ): person is {
        email: string;
        firstName: string | null;
        lastName: string | null;
        jobTitle: string | null;
        company: string | null;
        companyDomain: string | null;
        location: string | null;
      } => typeof person.email === "string" && person.email.trim().length > 0,
    )
    .map((person) => ({
      ...buildEmailLeadPayload(
        {
          email: person.email,
          firstName: person.firstName,
          lastName: person.lastName,
          jobTitle: person.jobTitle,
          company: person.company,
          companyDomain: person.companyDomain,
          location: person.location,
        },
        campaign.description ?? undefined,
      ),
    }));

  const missingPayloads = desiredPayloads.filter(
    (lead) => !ebCampaignLeadEmails.has(normalizeEmail(lead.email)),
  );

  console.log(
    `${LOG_PREFIX} mode=${APPLY ? "apply" : "dry-run"} campaign=${campaign.id} ebId=${campaign.emailBisonCampaignId} workspace=${campaign.workspaceSlug}`,
  );
  console.log(
    `${LOG_PREFIX} desired=${desiredPayloads.length} existingInEb=${ebCampaignLeadEmails.size} missing=${missingPayloads.length}`,
  );
  if (missingPayloads.length > 0) {
    console.log(`${LOG_PREFIX} missing sample:`);
    for (const lead of missingPayloads.slice(0, 10)) {
      console.log(`  - ${lead.email}`);
    }
  }

  if (!APPLY || missingPayloads.length === 0) {
    console.log(
      `${LOG_PREFIX} ${APPLY ? "nothing to do" : "dry-run complete"}`,
    );
    return;
  }

  const attachedLeadIds: number[] = [];
  let attempted = 0;
  let accepted = 0;

  for (let i = 0; i < missingPayloads.length; i += CHUNK_SIZE) {
    const chunk = missingPayloads.slice(i, i + CHUNK_SIZE);
    const upserted = await client.createOrUpdateLeadsMultiple(chunk);
    attempted += chunk.length;
    accepted += upserted.length;
    attachedLeadIds.push(...upserted.map((lead) => lead.id));
    console.log(
      `${LOG_PREFIX} chunk ${Math.floor(i / CHUNK_SIZE) + 1}: accepted ${upserted.length}/${chunk.length}`,
    );
  }

  if (attachedLeadIds.length > 0) {
    await client.attachLeadsToCampaign(
      campaign.emailBisonCampaignId,
      attachedLeadIds,
    );
  }

  console.log(
    `${LOG_PREFIX} reconciliation complete: accepted=${accepted}/${attempted}, attached=${attachedLeadIds.length}`,
  );
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} fatal:`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
