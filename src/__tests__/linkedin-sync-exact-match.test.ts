import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST as pushSyncPOST } from "@/app/api/linkedin/sync/push/route";
import { buildLinkedinProfileUrlCandidates } from "@/lib/linkedin/url";

const verifyWorkerAuthMock = vi.fn().mockReturnValue(true);
const notifyLinkedInMessageMock = vi.fn().mockResolvedValue(undefined);
const cancelActionsForPersonMock = vi.fn().mockResolvedValue(0);
const prismaAny = prisma as unknown as {
  person: { findFirst: ReturnType<typeof vi.fn> };
  linkedInConversation: {
    upsert: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  linkedInMessage: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  linkedInSyncStatus: { upsert: ReturnType<typeof vi.fn> };
};

function buildPushRequest(messages: Array<{
  eventUrn: string;
  senderUrn: string;
  deliveredAt: number;
}>) {
  return new NextRequest("http://localhost/api/linkedin/sync/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      senderId: "sender-1",
      conversations: [
        {
          entityUrn: "urn:li:msg_conversation:1",
          conversationId: "conv-1",
          participantName: "Prospect One",
          participantUrn: "urn:li:fsd_profile:ACoAAProspect123",
          participantProfileUrl: "https://www.linkedin.com/in/prospect/",
          participantHeadline: "Head of Ops",
          participantProfilePicUrl: null,
          lastActivityAt: Date.now(),
          unreadCount: 0,
          lastMessageSnippet: "hello",
          messages: messages.map((message) => ({
            ...message,
            senderName: "Prospect One",
            body: "Fresh inbound reply",
          })),
        },
      ],
    }),
  });
}

vi.mock("@/lib/linkedin/auth", () => ({
  verifyWorkerAuth: (...args: unknown[]) => verifyWorkerAuthMock(...args),
}));

vi.mock("@/lib/notifications", () => ({
  notifyLinkedInMessage: (...args: unknown[]) => notifyLinkedInMessageMock(...args),
}));

vi.mock("@/lib/linkedin/queue", () => ({
  cancelActionsForPerson: (...args: unknown[]) => cancelActionsForPersonMock(...args),
}));

describe("LinkedIn conversation sync exact person matching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LINKEDIN_WORKER_URL = "http://worker.local";
    process.env.WORKER_API_SECRET = "worker-secret";

    prismaAny.person.findFirst = vi.fn().mockResolvedValue({ id: "person-1" });
    (prisma.sender.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      workspaceSlug: "acme",
    });
    prismaAny.linkedInConversation = {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({
        id: "internal-conv-1",
        personId: "person-1",
      }),
      update: vi.fn().mockResolvedValue({}),
    };
    prismaAny.linkedInMessage = {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    };
    prismaAny.linkedInSyncStatus = {
      upsert: vi.fn().mockResolvedValue({}),
    };
    (prisma.linkedInAction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.linkedInAction.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("legacy sync helper matches people by exact LinkedIn URL variants instead of contains()", async () => {
    const { syncLinkedInConversations } = await import("@/lib/linkedin/sync");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        conversations: [
          {
            entityUrn: "urn:li:msg_conversation:1",
            conversationId: "conv-1",
            participantName: "John Doe",
            participantUrn: "urn:li:fsd_profile:1",
            participantProfileUrl: "https://www.linkedin.com/in/john-doe/?trk=people-guest_people_search-card",
            participantHeadline: "Head of Ops",
            participantProfilePicUrl: null,
            lastActivityAt: Date.now(),
            unreadCount: 0,
            lastMessageSnippet: "hello",
          },
        ],
      }),
    } as Response);

    await syncLinkedInConversations("sender-1");

    const expectedCandidates = buildLinkedinProfileUrlCandidates(
      "https://www.linkedin.com/in/john-doe/?trk=people-guest_people_search-card",
    );
    const where = prismaAny.person.findFirst.mock.calls[0][0].where;

    expect(where).toEqual({
      OR: expectedCandidates.map((candidate) => ({
        linkedinUrl: { equals: candidate, mode: "insensitive" },
      })),
    });
    expect(JSON.stringify(where)).not.toContain("contains");
    expect(
      prismaAny.linkedInConversation.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          personId: "person-1",
          participantProfileUrl: "/in/john-doe",
        }),
      }),
    );
  });

  it("push sync route uses the same exact-match URL candidates", async () => {
    const participantProfileUrl = "http://linkedin.com/in/john-doe/";
    const request = new NextRequest("http://localhost/api/linkedin/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "sender-1",
        conversations: [
          {
            entityUrn: "urn:li:msg_conversation:1",
            conversationId: "conv-1",
            participantName: "John Doe",
            participantUrn: "urn:li:fsd_profile:1",
            participantProfileUrl,
            participantHeadline: "Head of Ops",
            participantProfilePicUrl: null,
            lastActivityAt: Date.now(),
            unreadCount: 0,
            lastMessageSnippet: "hello",
            messages: [],
          },
        ],
      }),
    });

    const res = await pushSyncPOST(request);
    const body = await res.json();

    const expectedCandidates = buildLinkedinProfileUrlCandidates(
      participantProfileUrl,
    );
    const where = prismaAny.person.findFirst.mock.calls[0][0].where;

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      conversationsProcessed: 1,
      newInboundMessages: 0,
    });
    expect(where).toEqual({
      OR: expectedCandidates.map((candidate) => ({
        linkedinUrl: { equals: candidate, mode: "insensitive" },
      })),
    });
    expect(JSON.stringify(where)).not.toContain("contains");
    expect(
      prismaAny.linkedInConversation.upsert,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          personId: "person-1",
          participantProfileUrl: "/in/john-doe",
        }),
        update: expect.objectContaining({
          personId: "person-1",
          participantProfileUrl: "/in/john-doe",
        }),
      }),
    );
  });

  it("push sync name fallback is scoped to the sender workspace", async () => {
    const request = new NextRequest("http://localhost/api/linkedin/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "sender-1",
        conversations: [
          {
            entityUrn: "urn:li:msg_conversation:2",
            conversationId: "conv-2",
            participantName: "John Smith",
            participantUrn: "urn:li:fsd_profile:2",
            participantProfileUrl: null,
            participantHeadline: "COO",
            participantProfilePicUrl: null,
            lastActivityAt: Date.now(),
            unreadCount: 0,
            lastMessageSnippet: "hello",
            messages: [],
          },
        ],
      }),
    });

    const res = await pushSyncPOST(request);
    const body = await res.json();
    const where = prismaAny.person.findFirst.mock.calls[0][0].where;

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      conversationsProcessed: 1,
      newInboundMessages: 0,
    });
    expect(where).toEqual({
      firstName: { equals: "John", mode: "insensitive" },
      lastName: { equals: "Smith", mode: "insensitive" },
      workspaces: {
        some: {
          workspace: "acme",
        },
      },
    });
  });

  it("push sync deduplicates mixed URN formats and corrects the stored direction", async () => {
    prismaAny.linkedInConversation.findUnique.mockResolvedValue({
      id: "internal-conv-1",
      personId: "person-1",
    });
    prismaAny.linkedInMessage.findMany.mockResolvedValue([
      {
        id: "msg-1",
        eventUrn: "urn:li:fs_event:(urn:li:messagingThread:2-conv,2-message-abc)",
        senderUrn:
          "urn:li:fs_messagingMember:(urn:li:messagingThread:2-conv,ACoAAProspect123)",
        senderName: "Prospect",
        body: "Thanks for reaching out",
        isOutbound: true,
        deliveredAt: new Date("2026-04-24T10:00:00.000Z"),
      },
    ]);

    const request = new NextRequest("http://localhost/api/linkedin/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        senderId: "sender-1",
        conversations: [
          {
            entityUrn: "urn:li:msg_conversation:1",
            conversationId: "2-conv",
            participantName: "Prospect",
            participantUrn:
              "urn:li:fs_messagingMember:(urn:li:messagingThread:2-conv,ACoAAProspect123)",
            participantProfileUrl: "https://www.linkedin.com/in/prospect/",
            participantHeadline: "Head of Ops",
            participantProfilePicUrl: null,
            lastActivityAt: Date.now(),
            unreadCount: 0,
            lastMessageSnippet: "Thanks for reaching out",
            messages: [
              {
                eventUrn:
                  "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-message-abc)",
                senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
                senderName: "Prospect",
                body: "Thanks for reaching out",
                deliveredAt: Date.now(),
              },
            ],
          },
        ],
      }),
    });

    const res = await pushSyncPOST(request);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      conversationsProcessed: 1,
      newInboundMessages: 0,
    });
    expect(prismaAny.linkedInMessage.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventUrn:
            "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-message-abc)",
        }),
      }),
    );
    expect(prismaAny.linkedInMessage.update).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: {
        isOutbound: false,
        senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
      },
    });
  });

  it("notifies and increments unread count for a newly-created inbound message delivered now", async () => {
    prismaAny.linkedInMessage.create.mockImplementation(async ({ data }) => ({
      id: "fresh-now",
      ...data,
    }));

    const res = await pushSyncPOST(
      buildPushRequest([
        {
          eventUrn: "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-fresh-now)",
          senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
          deliveredAt: Date.now(),
        },
      ]),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      conversationsProcessed: 1,
      newInboundMessages: 1,
    });
    expect(notifyLinkedInMessageMock).toHaveBeenCalledTimes(1);
    expect(prismaAny.linkedInConversation.update).toHaveBeenCalledWith({
      where: { id: "internal-conv-1" },
      data: { unreadCount: { increment: 1 } },
    });
    expect(cancelActionsForPersonMock).toHaveBeenCalledWith("person-1", "acme");
  });

  it("notifies and increments unread count for a newly-created inbound message delivered one hour ago", async () => {
    prismaAny.linkedInMessage.create.mockImplementation(async ({ data }) => ({
      id: "fresh-one-hour",
      ...data,
    }));

    const res = await pushSyncPOST(
      buildPushRequest([
        {
          eventUrn: "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-fresh-hour)",
          senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
          deliveredAt: Date.now() - 60 * 60 * 1000,
        },
      ]),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.newInboundMessages).toBe(1);
    expect(notifyLinkedInMessageMock).toHaveBeenCalledTimes(1);
    expect(prismaAny.linkedInConversation.update).toHaveBeenCalledWith({
      where: { id: "internal-conv-1" },
      data: { unreadCount: { increment: 1 } },
    });
  });

  it("stores but does not notify, increment unread, or cancel actions for a stale inbound message delivered three hours ago", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    prismaAny.linkedInMessage.create.mockImplementation(async ({ data }) => ({
      id: "stale-three-hours",
      ...data,
    }));

    const res = await pushSyncPOST(
      buildPushRequest([
        {
          eventUrn: "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-stale-three-hours)",
          senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
          deliveredAt: Date.now() - 3 * 60 * 60 * 1000,
        },
      ]),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.newInboundMessages).toBe(0);
    expect(prismaAny.linkedInMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventUrn:
            "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-stale-three-hours)",
        }),
      }),
    );
    expect(notifyLinkedInMessageMock).not.toHaveBeenCalled();
    expect(prismaAny.linkedInConversation.update).not.toHaveBeenCalledWith({
      where: { id: "internal-conv-1" },
      data: { unreadCount: { increment: 1 } },
    });
    expect(cancelActionsForPersonMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "[sync/push] Skipped notification for stale inbound message stale-three-hours",
      ),
    );
    logSpy.mockRestore();
  });

  it("stores but does not notify for a years-old inbound backfill", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    prismaAny.linkedInMessage.create.mockImplementation(async ({ data }) => ({
      id: "james-court-regression",
      ...data,
    }));

    const res = await pushSyncPOST(
      buildPushRequest([
        {
          eventUrn: "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-stale-years)",
          senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
          deliveredAt: new Date("2020-01-07T11:04:44.930Z").getTime(),
        },
      ]),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.newInboundMessages).toBe(0);
    expect(prismaAny.linkedInMessage.create).toHaveBeenCalledTimes(1);
    expect(notifyLinkedInMessageMock).not.toHaveBeenCalled();
    expect(prismaAny.linkedInConversation.update).not.toHaveBeenCalledWith({
      where: { id: "internal-conv-1" },
      data: { unreadCount: { increment: 1 } },
    });
    logSpy.mockRestore();
  });

  it("does not apply the inbound freshness notification path to outbound messages", async () => {
    prismaAny.linkedInMessage.create.mockImplementation(async ({ data }) => ({
      id: "old-outbound",
      ...data,
    }));

    const res = await pushSyncPOST(
      buildPushRequest([
        {
          eventUrn: "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-old-outbound)",
          senderUrn: "urn:li:msg_messagingParticipant:ACoAASender456",
          deliveredAt: new Date("2020-01-07T11:04:44.930Z").getTime(),
        },
      ]),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.newInboundMessages).toBe(0);
    expect(prismaAny.linkedInMessage.create).toHaveBeenCalledTimes(1);
    expect(notifyLinkedInMessageMock).not.toHaveBeenCalled();
    expect(cancelActionsForPersonMock).not.toHaveBeenCalled();
  });
});
