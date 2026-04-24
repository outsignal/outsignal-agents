import "dotenv/config";

import { pathToFileURL } from "node:url";

import { prisma } from "@/lib/db";
import {
  findLinkedInMessageDuplicateGroups,
  type LinkedInMessageCleanupRecord,
} from "@/lib/linkedin/message-dedup";

interface LinkedInMessageDedupOptions {
  apply: boolean;
  workspaceSlug?: string;
}

interface LinkedInMessageDedupSummary {
  groups: number;
  deletedMessages: number;
  updatedMessages: number;
  perWorkspace: Record<string, number>;
}

interface LinkedInMessageDedupPrisma {
  linkedInConversation: {
    findMany: typeof prisma.linkedInConversation.findMany;
  };
  linkedInMessage: {
    update: typeof prisma.linkedInMessage.update;
    delete: typeof prisma.linkedInMessage.delete;
  };
  auditLog: {
    create: typeof prisma.auditLog.create;
  };
  $transaction: typeof prisma.$transaction;
}

function parseArgs(argv: string[]): LinkedInMessageDedupOptions {
  const apply = argv.includes("--apply");
  const workspaceIndex = argv.indexOf("--workspace");
  const workspaceSlug =
    workspaceIndex >= 0 ? argv[workspaceIndex + 1] || undefined : undefined;

  return { apply, workspaceSlug };
}

function printSummary(summary: LinkedInMessageDedupSummary): void {
  console.log(
    JSON.stringify(
      {
        groups: summary.groups,
        deletedMessages: summary.deletedMessages,
        updatedMessages: summary.updatedMessages,
        perWorkspace: summary.perWorkspace,
      },
      null,
      2,
    ),
  );
}

export async function runLinkedInMessageDedup(
  db: LinkedInMessageDedupPrisma,
  options: LinkedInMessageDedupOptions,
): Promise<LinkedInMessageDedupSummary> {
  const conversations = await db.linkedInConversation.findMany({
    where: options.workspaceSlug ? { workspaceSlug: options.workspaceSlug } : {},
    select: {
      id: true,
      conversationId: true,
      workspaceSlug: true,
      participantUrn: true,
      messages: {
        orderBy: { deliveredAt: "asc" },
        select: {
          id: true,
          eventUrn: true,
          senderUrn: true,
          body: true,
          isOutbound: true,
          deliveredAt: true,
        },
      },
    },
  });

  const flattenedMessages: LinkedInMessageCleanupRecord[] = conversations.flatMap(
    (conversation) =>
      conversation.messages.map((message) => ({
        id: message.id,
        conversationId: conversation.id,
        conversationExternalId: conversation.conversationId,
        workspaceSlug: conversation.workspaceSlug,
        participantUrn: conversation.participantUrn,
        eventUrn: message.eventUrn,
        senderUrn: message.senderUrn,
        body: message.body,
        isOutbound: message.isOutbound,
        deliveredAt: message.deliveredAt,
      })),
  );

  const duplicateGroups = findLinkedInMessageDuplicateGroups(flattenedMessages);
  const perWorkspace = duplicateGroups.reduce<Record<string, number>>((acc, group) => {
    acc[group.workspaceSlug] = (acc[group.workspaceSlug] ?? 0) + 1;
    return acc;
  }, {});

  for (const group of duplicateGroups) {
    console.log(
      JSON.stringify(
        {
          workspaceSlug: group.workspaceSlug,
          conversationId: group.conversationExternalId,
          dedupMethod: group.dedupMethod,
          keptMessageId: group.keptMessageId,
          deletedMessageIds: group.deletedMessageIds,
          rationale: group.rationale,
        },
        null,
        2,
      ),
    );
  }

  if (!options.apply) {
    const summary = {
      groups: duplicateGroups.length,
      deletedMessages: duplicateGroups.reduce(
        (sum, group) => sum + group.deletedMessageIds.length,
        0,
      ),
      updatedMessages: duplicateGroups.filter(
        (group) => group.keepNeedsDirectionUpdate,
      ).length,
      perWorkspace,
    };
    printSummary(summary);
    return summary;
  }

  for (const group of duplicateGroups) {
    await db.$transaction(async (tx) => {
      if (group.keepNeedsDirectionUpdate) {
        await tx.linkedInMessage.update({
          where: { id: group.keptMessageId },
          data: { isOutbound: group.correctIsOutbound },
        });
      }

      for (const deletedMessageId of group.deletedMessageIds) {
        await tx.linkedInMessage.delete({
          where: { id: deletedMessageId },
        });

        await tx.auditLog.create({
          data: {
            action: "linkedin_message_dedup",
            entityType: "LinkedInMessage",
            entityId: deletedMessageId,
            adminEmail: "system@outsignal.ai",
            metadata: {
              source: "linkedin_message_dedup",
              workspaceSlug: group.workspaceSlug,
              conversationId: group.conversationExternalId,
              keptMessageId: group.keptMessageId,
              deletedMessageId,
              dedupMethod: group.dedupMethod,
              rationale: group.rationale,
            },
          },
        });
      }
    });
  }

  const summary = {
    groups: duplicateGroups.length,
    deletedMessages: duplicateGroups.reduce(
      (sum, group) => sum + group.deletedMessageIds.length,
      0,
    ),
    updatedMessages: duplicateGroups.filter(
      (group) => group.keepNeedsDirectionUpdate,
    ).length,
    perWorkspace,
  };
  printSummary(summary);
  return summary;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runLinkedInMessageDedup(prisma as unknown as LinkedInMessageDedupPrisma, options);
}

const invokedPath = process.argv[1];
const isDirectExecution =
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(invokedPath).href;

if (isDirectExecution) {
  main()
    .catch((error) => {
      console.error("[linkedin-message-dedup] Failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
