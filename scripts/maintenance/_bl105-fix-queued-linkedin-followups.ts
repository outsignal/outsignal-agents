import { PrismaClient } from "@prisma/client";
import {
  buildTemplateContext,
  compileTemplate,
  resolveLastEmailMonth,
} from "@/lib/linkedin/sequencing";

const prisma = new PrismaClient();

const RAW_TOKEN_REGEX = /\{[A-Z_][A-Z0-9_]*\}/;
const SPINTAX_REGEX = /\{[^{}]*\|[^{}]*\}/;

function hasRenderResidue(text: string | null | undefined): boolean {
  const value = text ?? "";
  return RAW_TOKEN_REGEX.test(value) || SPINTAX_REGEX.test(value);
}

async function main() {
  const APPLY = process.argv.includes("--apply");

  const actions = await prisma.linkedInAction.findMany({
    where: {
      actionType: "message",
      status: "pending",
    },
    select: {
      id: true,
      personId: true,
      workspaceSlug: true,
      campaignName: true,
      sequenceStepRef: true,
      messageBody: true,
      scheduledFor: true,
      createdAt: true,
    },
    orderBy: [{ scheduledFor: "asc" }],
  });

  const flagged = actions.filter((action) => hasRenderResidue(action.messageBody));
  const people = await prisma.person.findMany({
    where: { id: { in: [...new Set(flagged.map((action) => action.personId))] } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      company: true,
      jobTitle: true,
      linkedinUrl: true,
      email: true,
    },
  });
  const peopleById = new Map(people.map((person) => [person.id, person]));
  console.log(
    `[bl105-fix-queued-linkedin-followups] pending message actions=${actions.length} flagged=${flagged.length} mode=${APPLY ? "apply" : "dry-run"}`,
  );

  for (const action of flagged) {
    if (!action.campaignName) {
      throw new Error(`Action ${action.id} has no campaignName`);
    }
    const person = peopleById.get(action.personId);
    if (!person) {
      throw new Error(`Action ${action.id} has no person`);
    }

    const campaign = await prisma.campaign.findUnique({
      where: {
        workspaceSlug_name: {
          workspaceSlug: action.workspaceSlug,
          name: action.campaignName,
        },
      },
      select: {
        id: true,
        description: true,
      },
    });

    const lastEmailMonth = resolveLastEmailMonth(campaign?.description);
    const context = buildTemplateContext(person, undefined, {
      lastEmailMonth,
    });

    const before = action.messageBody ?? "";
    const after = compileTemplate(before, context);

    const stillBad = hasRenderResidue(after);
    console.log("\n=================================================");
    console.log(`actionId=${action.id}`);
    console.log(`workspace=${action.workspaceSlug}`);
    console.log(`campaign=${action.campaignName}`);
    console.log(`personId=${action.personId}`);
    console.log(`scheduledFor=${action.scheduledFor?.toISOString() ?? "null"}`);
    console.log(`createdAt=${action.createdAt.toISOString()}`);
    console.log(`sequenceStepRef=${action.sequenceStepRef ?? "null"}`);
    console.log(`lastEmailMonth=${lastEmailMonth || "(empty)"}`);
    console.log(`before=${JSON.stringify(before)}`);
    console.log(`after=${JSON.stringify(after)}`);
    console.log(`stillBad=${stillBad}`);

    if (stillBad) {
      throw new Error(
        `Refusing to write action ${action.id}: render residue remains after compile`,
      );
    }

    if (APPLY) {
      await prisma.linkedInAction.update({
        where: { id: action.id },
        data: { messageBody: after },
      });
    }
  }

  if (APPLY) {
    console.log(
      `\n[bl105-fix-queued-linkedin-followups] applied ${flagged.length} queued LinkedIn follow-up updates`,
    );
  } else {
    console.log(
      `\n[bl105-fix-queued-linkedin-followups] dry-run complete for ${flagged.length} queued LinkedIn follow-ups`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
