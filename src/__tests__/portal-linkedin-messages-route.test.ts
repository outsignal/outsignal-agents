import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getPortalSessionMock,
  linkedInConversationFindFirstMock,
  linkedInMessageFindManyMock,
  linkedInMessageCreateMock,
  linkedInMessageUpdateMock,
} = vi.hoisted(() => ({
  getPortalSessionMock: vi.fn(),
  linkedInConversationFindFirstMock: vi.fn(),
  linkedInMessageFindManyMock: vi.fn(),
  linkedInMessageCreateMock: vi.fn(),
  linkedInMessageUpdateMock: vi.fn(),
}));

vi.mock("@/lib/portal-session", () => ({
  getPortalSession: (...args: unknown[]) => getPortalSessionMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    linkedInConversation: {
      findFirst: (...args: unknown[]) =>
        linkedInConversationFindFirstMock(...args),
    },
    linkedInMessage: {
      findMany: (...args: unknown[]) => linkedInMessageFindManyMock(...args),
      create: (...args: unknown[]) => linkedInMessageCreateMock(...args),
      update: (...args: unknown[]) => linkedInMessageUpdateMock(...args),
    },
  },
}));

describe("portal LinkedIn message refresh route", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    process.env.LINKEDIN_WORKER_URL = "https://worker.example.com";
    process.env.WORKER_API_SECRET = "worker-secret";

    getPortalSessionMock.mockResolvedValue({ workspaceSlug: "blanktag" });
    linkedInConversationFindFirstMock.mockResolvedValue({
      id: "conv-internal-1",
      conversationId: "2-conv",
      participantName: "Prospect",
      participantUrn:
        "urn:li:fs_messagingMember:(urn:li:messagingThread:2-conv,ACoAAProspect123)",
      senderId: "sender-1",
      workspaceSlug: "blanktag",
    });
  });

  it("deduplicates mixed URN formats on refresh and corrects direction classification", async () => {
    linkedInMessageFindManyMock
      .mockResolvedValueOnce([
        {
          id: "msg-1",
          conversationId: "conv-internal-1",
          eventUrn:
            "urn:li:fs_event:(urn:li:messagingThread:2-conv,2-message-abc)",
          senderUrn:
            "urn:li:fs_messagingMember:(urn:li:messagingThread:2-conv,ACoAAProspect123)",
          senderName: "Prospect",
          body: "Thanks for reaching out",
          isOutbound: true,
          deliveredAt: new Date("2026-04-24T10:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "msg-1",
          conversationId: "conv-internal-1",
          eventUrn:
            "urn:li:fs_event:(urn:li:messagingThread:2-conv,2-message-abc)",
          senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
          senderName: "Prospect",
          body: "Thanks for reaching out",
          isOutbound: false,
          deliveredAt: new Date("2026-04-24T10:00:00.000Z"),
        },
      ]);
    linkedInMessageUpdateMock.mockResolvedValue({});

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          {
            eventUrn:
              "urn:li:msg_message:(urn:li:fsd_profile:ACoAAProspect123,2-message-abc)",
            senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
            senderName: "Prospect",
            body: "Thanks for reaching out",
            deliveredAt: Date.parse("2026-04-24T10:00:00.000Z"),
          },
        ],
      }),
    });

    const { GET } = await import(
      "@/app/api/portal/inbox/linkedin/conversations/[conversationId]/messages/route"
    );

    const response = await GET(
      new NextRequest(
        "http://localhost/api/portal/inbox/linkedin/conversations/conv-internal-1/messages?refresh=true",
      ),
      { params: Promise.resolve({ conversationId: "conv-internal-1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(linkedInMessageCreateMock).not.toHaveBeenCalled();
    expect(linkedInMessageUpdateMock).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: {
        isOutbound: false,
        senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123",
      },
    });
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.isOutbound).toBe(false);
  });
});
