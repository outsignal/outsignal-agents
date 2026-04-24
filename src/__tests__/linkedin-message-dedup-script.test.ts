import { describe, expect, it } from "vitest";

import { runLinkedInMessageDedup } from "../../scripts/maintenance/_dedupe_linkedin_messages_2026-04-24";

type ConversationFixture = {
  id: string;
  conversationId: string;
  workspaceSlug: string;
  participantUrn: string | null;
  messages: Array<{
    id: string;
    eventUrn: string;
    senderUrn: string;
    body: string;
    isOutbound: boolean;
    deliveredAt: Date;
  }>;
};

function buildFakeDb(fixtures: ConversationFixture[]) {
  const conversations = structuredClone(
    fixtures.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        deliveredAt: new Date(message.deliveredAt),
      })),
    })),
  );
  const auditLogs: unknown[] = [];

  const tx = {
    linkedInMessage: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { isOutbound?: boolean };
      }) => {
        for (const conversation of conversations) {
          const message = conversation.messages.find((item) => item.id === where.id);
          if (!message) continue;
          if (data.isOutbound !== undefined) {
            message.isOutbound = data.isOutbound;
          }
          return message;
        }
        throw new Error(`Message ${where.id} not found`);
      },
      delete: async ({ where }: { where: { id: string } }) => {
        for (const conversation of conversations) {
          const index = conversation.messages.findIndex((item) => item.id === where.id);
          if (index === -1) continue;
          const [removed] = conversation.messages.splice(index, 1);
          return removed;
        }
        throw new Error(`Message ${where.id} not found`);
      },
    },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        auditLogs.push(data);
        return data;
      },
    },
  };

  return {
    linkedInConversation: {
      findMany: async ({
        where,
      }: {
        where?: { workspaceSlug?: string };
      }) =>
        conversations
          .filter(
            (conversation) =>
              !where?.workspaceSlug ||
              conversation.workspaceSlug === where.workspaceSlug,
          )
          .map((conversation) => ({
            id: conversation.id,
            conversationId: conversation.conversationId,
            workspaceSlug: conversation.workspaceSlug,
            participantUrn: conversation.participantUrn,
            messages: conversation.messages.map((message) => ({
              id: message.id,
              eventUrn: message.eventUrn,
              senderUrn: message.senderUrn,
              body: message.body,
              isOutbound: message.isOutbound,
              deliveredAt: message.deliveredAt,
            })),
          })),
    },
    linkedInMessage: tx.linkedInMessage,
    auditLog: tx.auditLog,
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) =>
      callback(tx),
    getConversations: () => conversations,
    getAuditLogs: () => auditLogs,
  };
}

describe("LinkedIn message dedupe script", () => {
  it("reports canonical and composite duplicate groups on dry-run", async () => {
    const db = buildFakeDb([
      {
        id: "conv-1",
        conversationId: "thread-1",
        workspaceSlug: "lime-recruitment",
        participantUrn:
          "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-1,ACoAAProspect123)",
        messages: [
          {
            id: "msg-1",
            eventUrn:
              "urn:li:fs_event:(urn:li:messagingThread:thread-1,2-message-abc)",
            senderUrn:
              "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-1,ACoAAProspect123)",
            body: "Thanks for reaching out",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T10:00:00.000Z"),
          },
          {
            id: "msg-2",
            eventUrn:
              "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-message-abc)",
            senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
            body: "Thanks for reaching out",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T10:00:00.500Z"),
          },
        ],
      },
      {
        id: "conv-2",
        conversationId: "thread-2",
        workspaceSlug: "yoopknows",
        participantUrn: "urn:li:msg_messagingParticipant:ACoAAProspect456",
        messages: [
          {
            id: "msg-3",
            eventUrn: "legacy-no-canonical-1",
            senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect456",
            body: "Can we talk tomorrow about the warehouse manager role and next steps?",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T11:00:00.000Z"),
          },
          {
            id: "msg-4",
            eventUrn: "legacy-no-canonical-2",
            senderUrn:
              "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-2,ACoAAProspect456)",
            body: "Can we talk tomorrow about the warehouse manager role and next steps?",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T11:00:00.700Z"),
          },
        ],
      },
    ]);

    const result = await runLinkedInMessageDedup(db as never, { apply: false });

    expect(result).toEqual({
      groups: 2,
      deletedMessages: 2,
      updatedMessages: 2,
      perWorkspace: {
        "lime-recruitment": 1,
        yoopknows: 1,
      },
    });
  });

  it("supports workspace-scoped apply without touching other workspaces", async () => {
    const db = buildFakeDb([
      {
        id: "conv-1",
        conversationId: "thread-1",
        workspaceSlug: "lime-recruitment",
        participantUrn:
          "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-1,ACoAAProspect123)",
        messages: [
          {
            id: "msg-1",
            eventUrn:
              "urn:li:fs_event:(urn:li:messagingThread:thread-1,2-message-abc)",
            senderUrn:
              "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-1,ACoAAProspect123)",
            body: "Thanks for reaching out",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T10:00:00.000Z"),
          },
          {
            id: "msg-2",
            eventUrn:
              "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-message-abc)",
            senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
            body: "Thanks for reaching out",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T10:00:00.500Z"),
          },
        ],
      },
      {
        id: "conv-2",
        conversationId: "thread-2",
        workspaceSlug: "yoopknows",
        participantUrn: "urn:li:msg_messagingParticipant:ACoAAProspect456",
        messages: [
          {
            id: "msg-3",
            eventUrn: "legacy-no-canonical-1",
            senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect456",
            body: "Can we talk tomorrow about the warehouse manager role and next steps?",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T11:00:00.000Z"),
          },
          {
            id: "msg-4",
            eventUrn: "legacy-no-canonical-2",
            senderUrn:
              "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-2,ACoAAProspect456)",
            body: "Can we talk tomorrow about the warehouse manager role and next steps?",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T11:00:00.700Z"),
          },
        ],
      },
    ]);

    const result = await runLinkedInMessageDedup(db as never, {
      apply: true,
      workspaceSlug: "lime-recruitment",
    });

    expect(result).toEqual({
      groups: 1,
      deletedMessages: 1,
      updatedMessages: 1,
      perWorkspace: {
        "lime-recruitment": 1,
      },
    });
    expect(
      db
        .getConversations()
        .find((conversation) => conversation.workspaceSlug === "lime-recruitment")
        ?.messages,
    ).toHaveLength(1);
    expect(
      db
        .getConversations()
        .find((conversation) => conversation.workspaceSlug === "yoopknows")
        ?.messages,
    ).toHaveLength(2);
    expect(db.getAuditLogs()).toHaveLength(1);
  });

  it("is idempotent on repeated apply runs", async () => {
    const db = buildFakeDb([
      {
        id: "conv-1",
        conversationId: "thread-1",
        workspaceSlug: "lime-recruitment",
        participantUrn:
          "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-1,ACoAAProspect123)",
        messages: [
          {
            id: "msg-1",
            eventUrn:
              "urn:li:fs_event:(urn:li:messagingThread:thread-1,2-message-abc)",
            senderUrn:
              "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-1,ACoAAProspect123)",
            body: "Thanks for reaching out",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T10:00:00.000Z"),
          },
          {
            id: "msg-2",
            eventUrn:
              "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-message-abc)",
            senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
            body: "Thanks for reaching out",
            isOutbound: true,
            deliveredAt: new Date("2026-04-24T10:00:00.500Z"),
          },
        ],
      },
    ]);

    const firstRun = await runLinkedInMessageDedup(db as never, { apply: true });
    const secondRun = await runLinkedInMessageDedup(db as never, { apply: true });

    expect(firstRun.groups).toBe(1);
    expect(secondRun).toEqual({
      groups: 0,
      deletedMessages: 0,
      updatedMessages: 0,
      perWorkspace: {},
    });
  });

  it("does not composite-dedupe short repeated messages", async () => {
    const db = buildFakeDb([
      {
        id: "conv-1",
        conversationId: "thread-1",
        workspaceSlug: "lime-recruitment",
        participantUrn:
          "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-1,ACoAAProspect123)",
        messages: [
          {
            id: "msg-1",
            eventUrn: "legacy-no-canonical-1",
            senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
            body: "ok",
            isOutbound: false,
            deliveredAt: new Date("2026-04-24T10:00:00.000Z"),
          },
          {
            id: "msg-2",
            eventUrn: "legacy-no-canonical-2",
            senderUrn:
              "urn:li:fs_messagingMember:(urn:li:messagingThread:thread-1,ACoAAProspect123)",
            body: "ok",
            isOutbound: false,
            deliveredAt: new Date("2026-04-24T10:00:00.400Z"),
          },
        ],
      },
    ]);

    const result = await runLinkedInMessageDedup(db as never, { apply: false });

    expect(result).toEqual({
      groups: 0,
      deletedMessages: 0,
      updatedMessages: 0,
      perWorkspace: {},
    });
  });
});
