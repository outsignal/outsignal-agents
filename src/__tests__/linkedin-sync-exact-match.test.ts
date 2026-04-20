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
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  linkedInSyncStatus: { upsert: ReturnType<typeof vi.fn> };
};

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
});
