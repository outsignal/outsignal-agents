import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  getPortalSessionMock,
  requireAdminAuthMock,
  replyFindManyMock,
  linkedInConversationFindFirstMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  getPortalSessionMock: vi.fn(),
  requireAdminAuthMock: vi.fn(),
  replyFindManyMock: vi.fn(),
  linkedInConversationFindFirstMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/portal-session", () => ({
  getPortalSession: (...args: unknown[]) => getPortalSessionMock(...args),
}));

vi.mock("@/lib/require-admin-auth", () => ({
  requireAdminAuth: (...args: unknown[]) => requireAdminAuthMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    reply: {
      findMany: (...args: unknown[]) => replyFindManyMock(...args),
    },
    linkedInConversation: {
      findFirst: (...args: unknown[]) =>
        linkedInConversationFindFirstMock(...args),
    },
    workspace: {
      findUnique: (...args: unknown[]) => workspaceFindUniqueMock(...args),
    },
  },
}));

function makeRequest(threadId: number): NextRequest {
  return new NextRequest(
    `http://localhost/api/portal/inbox/email/threads/${threadId}`,
  );
}

function inboundReply(overrides: Record<string, unknown> = {}) {
  return {
    id: "reply-1",
    workspaceSlug: "lime-recruitment",
    senderEmail: "nikki.mcdonald@ibstock.co.uk",
    senderName: "Nikki McDonald",
    subject: "RE: 24/7 shift cover",
    bodyText: "Hi there, sorry but we have a designated agency.",
    receivedAt: new Date("2026-05-01T15:47:04.000Z"),
    emailBisonReplyId: 11825,
    emailBisonParentId: null,
    direction: "inbound",
    outboundSubject: "24/7 shift cover",
    outboundBody: null,
    htmlBody: null,
    intent: "objection",
    sentiment: "neutral",
    interested: false,
    aiSuggestedReply: null,
    ebSenderEmailId: null,
    personId: null,
    leadEmail: "nikki.mcdonald@ibstock.co.uk",
    ...overrides,
  };
}

async function getPortalThread() {
  const { GET } = await import(
    "@/app/api/portal/inbox/email/threads/[threadId]/route"
  );

  return GET(makeRequest(11825), {
    params: Promise.resolve({ threadId: "11825" }),
  });
}

async function getAdminThread() {
  const { GET } = await import(
    "@/app/api/admin/inbox/email/threads/[threadId]/route"
  );

  return GET(makeRequest(11825), {
    params: Promise.resolve({ threadId: "11825" }),
  });
}

async function getBothThreadBodies() {
  const portalResponse = await getPortalThread();
  const adminResponse = await getAdminThread();

  expect(portalResponse.status).toBe(200);
  expect(adminResponse.status).toBe(200);

  return {
    portal: await portalResponse.json(),
    admin: await adminResponse.json(),
  };
}

describe("email thread detail routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "lime-recruitment",
      email: "jamie@example.com",
      role: "owner",
      exp: Infinity,
    });
    requireAdminAuthMock.mockResolvedValue({
      email: "admin@example.com",
      role: "admin",
    });
    linkedInConversationFindFirstMock.mockResolvedValue(null);
    workspaceFindUniqueMock.mockResolvedValue({ name: "Lime Recruitment" });
  });

  it("does not emit an outbound context message with null bodyText in portal or admin", async () => {
    replyFindManyMock.mockResolvedValue([inboundReply()]);

    const { portal, admin } = await getBothThreadBodies();

    for (const body of [portal, admin]) {
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0]).toMatchObject({
        id: "reply-1",
        bodyText: "Hi there, sorry but we have a designated agency.",
      });
      expect(
        body.messages.some(
          (message: { id: string; bodyText?: string | null }) =>
            message.id === "outbound-context" || message.bodyText == null,
        ),
      ).toBe(false);
    }
  });

  it("returns identical message shapes for portal and admin", async () => {
    replyFindManyMock.mockResolvedValue([
      inboundReply({
        outboundBody:
          "Hi Nikki, most factory managers already have agencies on their books.",
      }),
    ]);

    const { portal, admin } = await getBothThreadBodies();

    expect(admin.messages).toEqual(portal.messages);
    expect(admin.threadMeta).toEqual(portal.threadMeta);
    expect(admin.crossChannel).toEqual(portal.crossChannel);
  });

  it("prepends outbound context when the original outbound body is available", async () => {
    replyFindManyMock.mockResolvedValue([
      inboundReply({
        outboundBody:
          "Hi Nikki, most factory managers already have agencies on their books.",
      }),
    ]);

    const { portal } = await getBothThreadBodies();

    expect(portal.messages[0]).toMatchObject({
      id: "outbound-context",
      direction: "outbound",
      subject: "24/7 shift cover",
      bodyText:
        "Hi Nikki, most factory managers already have agencies on their books.",
      isOutboundContext: true,
    });
    expect(portal.messages[1]).toMatchObject({ id: "reply-1" });
  });

  it("does not emit outbound context when subject and body are both null", async () => {
    replyFindManyMock.mockResolvedValue([
      inboundReply({ outboundSubject: null, outboundBody: null }),
    ]);

    const { portal, admin } = await getBothThreadBodies();

    expect(portal.messages).toHaveLength(1);
    expect(admin.messages).toEqual(portal.messages);
    expect(portal.messages[0]).toMatchObject({ id: "reply-1" });
  });

  it("renders outbound context body when subject is null and keeps real message subject in thread meta", async () => {
    replyFindManyMock.mockResolvedValue([
      inboundReply({
        outboundSubject: null,
        outboundBody: "Hi Nikki, can we help with shift cover?",
      }),
    ]);

    const { portal, admin } = await getBothThreadBodies();

    expect(portal.messages[0]).toMatchObject({
      id: "outbound-context",
      subject: null,
      bodyText: "Hi Nikki, can we help with shift cover?",
    });
    expect(portal.threadMeta.subject).toBe("RE: 24/7 shift cover");
    expect(admin.messages).toEqual(portal.messages);
  });

  it("does not emit outbound context for empty subject and null body", async () => {
    replyFindManyMock.mockResolvedValue([
      inboundReply({ outboundSubject: "", outboundBody: null }),
    ]);

    const { portal, admin } = await getBothThreadBodies();

    expect(portal.messages).toHaveLength(1);
    expect(admin.messages).toEqual(portal.messages);
    expect(portal.messages[0]).toMatchObject({ id: "reply-1" });
  });

  it("does not emit outbound context for whitespace-only body", async () => {
    replyFindManyMock.mockResolvedValue([
      inboundReply({ outboundSubject: "24/7 shift cover", outboundBody: " " }),
    ]);

    const { portal, admin } = await getBothThreadBodies();

    expect(portal.messages).toHaveLength(1);
    expect(admin.messages).toEqual(portal.messages);
    expect(portal.messages[0]).toMatchObject({ id: "reply-1" });
  });
});
