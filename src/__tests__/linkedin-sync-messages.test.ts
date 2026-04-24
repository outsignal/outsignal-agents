import { beforeEach, describe, expect, it, vi } from "vitest";

describe("syncLinkedInMessages", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    process.env.LINKEDIN_WORKER_URL = "https://worker.example.com";
    process.env.WORKER_API_SECRET = "worker-secret";
  });

  it("deduplicates mixed URN formats and fixes inbound direction without creating a second row", async () => {
    const { syncLinkedInMessages } = await import("@/lib/linkedin/sync-messages");

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

    const findManyMock = vi.fn().mockResolvedValue([
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
    const createMock = vi.fn();
    const updateMock = vi.fn().mockResolvedValue({});

    const prisma = {
      linkedInMessage: {
        findMany: findManyMock,
        create: createMock,
        update: updateMock,
      },
    } as const;

    const result = await syncLinkedInMessages(
      prisma as never,
      {
        id: "internal-conv-1",
        conversationId: "2-conv",
        senderId: "sender-1",
        participantUrn:
          "urn:li:fs_messagingMember:(urn:li:messagingThread:2-conv,ACoAAProspect123)",
      },
    );

    expect(result).toEqual({ total: 1, newInbound: 0 });
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "msg-1" },
      data: { isOutbound: false, senderUrn: "urn:li:msg_messagingParticipant:ACoAAProspect123" },
    });
  });
});
