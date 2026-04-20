import { prisma } from "@/lib/db";
import { getClientForWorkspace } from "@/lib/workspaces";
import { buildEmailLeadPayload } from "@/lib/emailbison/lead-payload";
import { EMAILBISON_STANDARD_SEQUENCE_CUSTOM_VARIABLES } from "@/lib/emailbison/custom-variable-names";

const APPLY = process.argv.includes("--apply");
const CHUNK_SIZE = 500;

function hasSupportedCustomVars(sequence: string | null): boolean {
  if (!sequence) return false;
  return sequence.includes("{LOCATION}") || sequence.includes("{LASTEMAILMONTH}");
}

async function main() {
  const campaigns = await prisma.campaign.findMany({
    where: {
      status: { in: ["deployed", "active", "paused"] },
      emailSequence: { not: null },
    },
    select: {
      id: true,
      name: true,
      workspaceSlug: true,
      description: true,
      emailSequence: true,
      targetListId: true,
    },
    orderBy: [{ workspaceSlug: "asc" }, { name: "asc" }],
  });

  const relevant = campaigns.filter(
    (campaign) =>
      campaign.targetListId && hasSupportedCustomVars(campaign.emailSequence),
  );

  console.log(
    `[backfill-email-custom-variables] mode=${APPLY ? "apply" : "dry-run"} campaigns=${relevant.length}`,
  );

  const workspaceClients = new Map<
    string,
    Awaited<ReturnType<typeof getClientForWorkspace>>
  >();

  for (const campaign of relevant) {
    const people = await prisma.targetListPerson.findMany({
      where: { listId: campaign.targetListId! },
      include: { person: true },
    });

    const uniqueByEmail = new Map<string, ReturnType<typeof buildEmailLeadPayload>>();
    for (const entry of people) {
      const email = entry.person.email;
      if (!email) continue;
      const payload = buildEmailLeadPayload(
        {
          email,
          firstName: entry.person.firstName,
          lastName: entry.person.lastName,
          jobTitle: entry.person.jobTitle,
          company: entry.person.company,
          companyDomain: entry.person.companyDomain,
          location: entry.person.location,
        },
        campaign.description,
      );
      if (!payload.customVariables?.length) continue;
      uniqueByEmail.set(email, payload);
    }

    const payloads = Array.from(uniqueByEmail.values());
    console.log(
      `- ${campaign.workspaceSlug} :: ${campaign.name} :: payloads=${payloads.length}`,
    );

    if (!APPLY || payloads.length === 0) continue;

    let client = workspaceClients.get(campaign.workspaceSlug);
    if (!client) {
      client = await getClientForWorkspace(campaign.workspaceSlug);
      await client.ensureCustomVariables([
        ...EMAILBISON_STANDARD_SEQUENCE_CUSTOM_VARIABLES,
      ]);
      workspaceClients.set(campaign.workspaceSlug, client);
    }

    for (let i = 0; i < payloads.length; i += CHUNK_SIZE) {
      const chunk = payloads.slice(i, i + CHUNK_SIZE);
      await client.createOrUpdateLeadsMultiple(chunk);
    }
  }
}

main()
  .catch((err) => {
    console.error("[backfill-email-custom-variables]", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
